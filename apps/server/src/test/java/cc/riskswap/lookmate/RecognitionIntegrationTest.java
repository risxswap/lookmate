package cc.riskswap.lookmate;
import cc.riskswap.lookmate.mapper.RecognitionWorkMapper;
import cc.riskswap.lookmate.service.*;
import cc.riskswap.lookmate.storage.*;
import java.util.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
@EnabledIfEnvironmentVariable(named="LOOKMATE_INTEGRATION",matches="true")
@SpringBootTest(properties="lookmate.jobs.enabled=false")
class RecognitionIntegrationTest {
    static final long USER=-921,FILE=9007199254790000L;
    @Autowired WardrobeService wardrobe;@Autowired RecognitionExecutor executor;@org.springframework.test.context.bean.override.mockito.MockitoSpyBean RecognitionWorkMapper work;@Autowired JdbcTemplate db;
    @MockitoBean RecognitionAvailability availability;@MockitoBean RecognitionGateway gateway;@MockitoBean ObjectStorage storage;
    @BeforeEach void setup(){clean();doAnswer(inv->db.query("SELECT * FROM dress_recognition WHERE user_id=? AND status='RUNNING' AND lease_until<UTC_TIMESTAMP(3)",new org.springframework.jdbc.core.BeanPropertyRowMapper<>(cc.riskswap.lookmate.entity.RecognitionWorkRow.class),USER)).when(work).expired();db.update("INSERT INTO user(id,username,password_hash,created_at,updated_at) VALUES(?,'recognitiontest','test',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",USER);db.update("INSERT INTO file_asset(id,user_id,bucket,storage_key,status,mime_type,size_bytes,width,height,created_at,updated_at) VALUES(?,?,'test','recognition/image','READY','image/jpeg',100,10,10,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",FILE,USER);when(availability.available()).thenReturn(true);when(availability.configSnapshot()).thenReturn("{}");when(storage.signedUrl(anyString(),anyString(),anyLong())).thenReturn("https://test.invalid/private");}
    @AfterEach void clean(){for(String t:List.of("model_call","dress_recognition","dress_image","dress","file_asset"))db.update("DELETE FROM "+t+" WHERE user_id=?",USER);db.update("DELETE FROM user WHERE id=?",USER);}
    private cc.riskswap.lookmate.dto.DressDto create(){return wardrobe.create(USER,Map.of("name","衣物","categoryId",wardrobe.categories().getFirst().getId(),"images",List.of(Map.of("fileId",""+FILE))));}
    private cc.riskswap.lookmate.entity.RecognitionWorkRow row(){return work.pending().stream().filter(r->r.getUserId()==USER).findFirst().orElseThrow();}
    @Test void savesValidatedFeaturesWithoutTouchingManual()throws Exception{
        var d=create();String image=d.getImages().getFirst().getId();wardrobe.manual(USER,d.getId(),image,Map.of("version","0","manualFeatures",Map.of("pattern","人工条纹")));
        when(gateway.recognize(anyString(),anyList())).thenReturn(new RecognitionGateway.Result("request-safe",Map.of(image,Map.of("pattern","AI纹理"))));executor.execute(row());
        assertThat(db.queryForObject("SELECT status FROM dress_recognition WHERE user_id=?",String.class,USER)).isEqualTo("SUCCEEDED");assertThat(db.queryForObject("SELECT pattern FROM dress_image WHERE user_id=?",String.class,USER)).isEqualTo("AI纹理");assertThat(db.queryForObject("SELECT manual_features FROM dress_image WHERE user_id=?",String.class,USER)).contains("人工条纹");assertThat(db.queryForObject("SELECT version FROM dress_image WHERE user_id=?",Long.class,USER)).isEqualTo(1);assertThat(db.queryForObject("SELECT status FROM model_call WHERE user_id=?",String.class,USER)).isEqualTo("SUCCEEDED");
    }
    @Test void transportFailureIsUnknownAndDoesNotRetry()throws Exception{create();when(gateway.recognize(anyString(),anyList())).thenThrow(new java.io.IOException());var r=row();executor.execute(r);executor.execute(r);assertThat(db.queryForObject("SELECT status FROM dress_recognition WHERE user_id=?",String.class,USER)).isEqualTo("UNKNOWN");assertThat(db.queryForObject("SELECT holds_input_assets FROM dress_recognition WHERE user_id=?",Integer.class,USER)).isEqualTo(1);verify(gateway,times(1)).recognize(anyString(),anyList());}
    @Test void malformedReturnedImageSetIsFailedNotUnknown()throws Exception{
        create();when(gateway.recognize(anyString(),anyList())).thenReturn(new RecognitionGateway.Result("bad",Map.of()));executor.execute(row());
        assertThat(db.queryForObject("SELECT status FROM dress_recognition WHERE user_id=?",String.class,USER)).isEqualTo("FAILED");assertThat(db.queryForObject("SELECT error_code FROM dress_recognition WHERE user_id=?",String.class,USER)).isEqualTo("INVALID_MODEL_OUTPUT");
    }
    @Test void configMismatchFailsBeforeSending()throws Exception{create();when(availability.configSnapshot()).thenReturn("{\"configVersion\":2}");executor.execute(row());assertThat(db.queryForObject("SELECT error_code FROM dress_recognition WHERE user_id=?",String.class,USER)).isEqualTo("RECOGNITION_CONFIG_UNAVAILABLE");verifyNoInteractions(gateway);}
    @Test void expiredSentExecutionBecomesUnknownWithoutAnotherCall(){
        create();var r=row();db.update("UPDATE dress_recognition SET status='RUNNING',attempt_token='expired',current_call_id=123,lease_until=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE id=?",r.getId());
        executor.recover();assertThat(db.queryForObject("SELECT status FROM dress_recognition WHERE user_id=?",String.class,USER)).isEqualTo("UNKNOWN");verifyNoInteractions(gateway);
    }
    @Test void expiredUnsentExecutionFailsSafely(){
        create();var r=row();db.update("UPDATE dress_recognition SET status='RUNNING',attempt_token='expired',lease_until=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE id=?",r.getId());
        executor.recover();assertThat(db.queryForObject("SELECT status FROM dress_recognition WHERE user_id=?",String.class,USER)).isEqualTo("FAILED");assertThat(db.queryForObject("SELECT holds_input_assets FROM dress_recognition WHERE user_id=?",Integer.class,USER)).isZero();verifyNoInteractions(gateway);
    }
    @Test void lateResultCannotOverwriteChangedImageSet()throws Exception{var d=create();String image=d.getImages().getFirst().getId();when(gateway.recognize(anyString(),anyList())).thenAnswer(i->{db.update("UPDATE dress SET image_revision=image_revision+1 WHERE user_id=?",USER);db.update("UPDATE dress_recognition SET status='SUPERSEDED',attempt_token=NULL WHERE user_id=?",USER);return new RecognitionGateway.Result("late",Map.of(image,Map.of("pattern","late")));});executor.execute(row());assertThat(db.queryForObject("SELECT pattern FROM dress_image WHERE user_id=?",String.class,USER)).isNull();assertThat(db.queryForObject("SELECT status FROM dress_recognition WHERE user_id=?",String.class,USER)).isEqualTo("SUPERSEDED");}
}
