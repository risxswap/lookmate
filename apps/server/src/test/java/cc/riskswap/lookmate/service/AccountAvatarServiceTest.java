package cc.riskswap.lookmate.service;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import cc.riskswap.lookmate.common.exception.ApiException;
import cc.riskswap.lookmate.dao.entity.*;
import cc.riskswap.lookmate.dao.mapper.*;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;

class AccountAvatarServiceTest {
    final UserMapper users = mock(UserMapper.class);
    final FileMapper files = mock(FileMapper.class);
    final DressMapper dresses = mock(DressMapper.class);
    final PlatformTransactionManager tm = mock(PlatformTransactionManager.class);
    final AccountAvatarService service = new AccountAvatarService(users, files, dresses, tm);

    AccountAvatarServiceTest() {
        when(tm.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
    }

    UserEntity user() {
        var u = new UserEntity();
        u.setId(1L);
        u.setStatus("ACTIVE");
        u.setAvatarFileId(10L);
        when(users.lock(1L)).thenReturn(u);
        return u;
    }

    @Test
    void foreignOrDeletingFileCannotBecomeAvatar() {
        user();
        assertThatThrownBy(() -> service.save(1L, 20L)).isInstanceOf(ApiException.class);
        verify(users, never()).avatar(any(), any());
        var f = new FileAssetRow();
        f.setStatus("DELETING");
        when(files.lock(1L, 20L)).thenReturn(f);
        assertThatThrownBy(() -> service.save(1L, 20L)).isInstanceOf(ApiException.class);
        verify(dresses, never()).bindFile(any(), any());
    }

    @Test
    void replacingAvatarLocksFilesInOrderAndSchedulesOldReference() {
        user();
        var f = new FileAssetRow();
        f.setStatus("TEMP");
        f.setDbNow(Instant.parse("2026-10-30T00:00:00Z"));
        f.setExpiresAt(f.getDbNow().plusSeconds(30));
        when(files.lock(1L, 5L)).thenReturn(f);
        assertThat(service.save(1L, 5L).getAvatarFileId()).isEqualTo("5");
        var order = inOrder(users, files, dresses);
        order.verify(users).lock(1L);
        order.verify(files).lock(1L, 5L);
        order.verify(files).lock(1L, 10L);
        order.verify(dresses).bindFile(1L, 5L);
        order.verify(users).avatar(1L, 5L);
        order.verify(dresses).scheduleCleanup(1L, 10L);
    }

    @Test
    void clearingAvatarDoesNotReplacePersonalPhotos() {
        user();
        assertThat(service.save(1L, null).getAvatarFileId()).isNull();
        verify(users).avatar(1L, null);
        verify(dresses).scheduleCleanup(1L, 10L);
        verify(dresses, never()).bindFile(any(), any());
    }
}
