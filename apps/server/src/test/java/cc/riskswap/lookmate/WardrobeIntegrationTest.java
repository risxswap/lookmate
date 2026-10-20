package cc.riskswap.lookmate;

import java.util.*;
import java.util.concurrent.*;
import cc.riskswap.lookmate.api.ApiException;
import cc.riskswap.lookmate.mapper.DressMapper;
import cc.riskswap.lookmate.service.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

@EnabledIfEnvironmentVariable(named="LOOKMATE_INTEGRATION",matches="true")
@SpringBootTest(properties="lookmate.jobs.enabled=false")
class WardrobeIntegrationTest {
    private static final long USER=-901, OTHER=-902, FILE=9007199254760000L;
    @Autowired WardrobeService service;
    @Autowired cc.riskswap.lookmate.config.RecognitionProperties recognitionProperties;
    @Autowired JdbcTemplate jdbc;
    @Autowired org.springframework.web.context.WebApplicationContext webContext;
    @MockitoSpyBean DressMapper mapper;
    @MockitoBean RecognitionAvailability availability;
    @BeforeEach void setup() {
        clean(); recognitionProperties.setPendingLimit(100); recognitionProperties.setUserPendingLimit(20); when(availability.available()).thenReturn(false); when(availability.configSnapshot()).thenReturn("{}");
        for(long user:new long[]{USER,OTHER}) jdbc.update("INSERT INTO `user`(id,username,password_hash,created_at,updated_at) VALUES(?,?,'TEST',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",user,"wardrobe_test_"+-user);
        for(int i=0;i<5;i++) jdbc.update("INSERT INTO file_asset(id,user_id,bucket,storage_key,status,mime_type,size_bytes,width,height,expires_at,created_at,updated_at) VALUES(?,?,'test',?,'TEMP','image/jpeg',100,10,10,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 HOUR),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",FILE+i,i==4?OTHER:USER,"wardrobe/"+i);
    }
    @AfterEach void clean() {
        reset(mapper);
        for(String table:List.of("model_call","dress_recognition","dress_image","dress","design_task_asset","design_task","file_asset")) jdbc.update("DELETE FROM "+table+" WHERE user_id IN (?,?)",USER,OTHER);
        jdbc.update("DELETE FROM `user` WHERE id IN (?,?)",USER,OTHER);
    }
    private Map<String,Object> createBody() { return Map.of("name","  通勤上衣  ","categoryId",service.categories().getFirst().getId(),"images",List.of(Map.of("fileId",""+FILE),Map.of("fileId",""+(FILE+1)))); }
    private void error(Runnable op,String code) { assertThatThrownBy(op::run).isInstanceOfSatisfying(ApiException.class,e->assertThat(e.getCode()).isEqualTo(code)); }
    @Test void savesOnceReordersIdentityAndTextDoesNotRecognize() {
        var d=service.create(USER,createBody()); assertThat(d.getName()).isEqualTo("通勤上衣"); assertThat(d.getRecognition().getStatus()).isEqualTo("FAILED");
        assertThat(d.getRecognition().getErrorCode()).isEqualTo("RECOGNITION_UNAVAILABLE");
        assertThat(jdbc.queryForObject("SELECT status FROM file_asset WHERE id=?",String.class,FILE)).isEqualTo("READY");
        var ids=d.getImages().stream().map(i->i.getId()).toList();
        d=service.patch(USER,d.getId(),Map.of("notes","test","seasons",List.of("SPRING","WINTER")));
        assertThat(d.getImageRevision()).isEqualTo("1"); assertThat(count("dress_recognition")).isEqualTo(1);
        d=service.patch(USER,d.getId(),Map.of("images",List.of(Map.of("imageId",ids.get(1)),Map.of("imageId",ids.get(0)))));
        assertThat(d.getImageRevision()).isEqualTo("2"); assertThat(count("dress_recognition")).isEqualTo(2);
        assertThat(d.getImages()).extracting(i->i.getId()).containsExactly(ids.get(1),ids.get(0));
        String id=d.getId(); error(()->service.patch(USER,id,Map.of("images",List.of())),"VALIDATION_ERROR");
        assertThat(service.detail(USER,id).getImages()).hasSize(2);
        assertThat(service.list(USER,"2147483647","100",null).getItems()).isEmpty();
        error(()->service.detail(OTHER,id),"DRESS_NOT_FOUND"); error(()->service.delete(OTHER,id),"DRESS_NOT_FOUND");
    }
    @Test void rejectsForeignExpiredInvalidMetadataAndRollsBackCreate() {
        var body=new HashMap<>(createBody());
        for(long file:new long[]{FILE+4,FILE+99}) { body.put("images",List.of(Map.of("fileId",""+file))); error(()->service.create(USER,body),"FILE_NOT_FOUND"); }
        jdbc.update("UPDATE file_asset SET expires_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 SECOND) WHERE id=?",FILE);
        body.put("images",List.of(Map.of("fileId",""+FILE))); error(()->service.create(USER,body),"FILE_NOT_USABLE");
        jdbc.update("UPDATE file_asset SET width=NULL WHERE id=?",FILE+1);
        body.put("images",List.of(Map.of("fileId",""+(FILE+1)))); error(()->service.create(USER,body),"FILE_NOT_USABLE");
        assertThat(count("dress")).isZero(); assertThat(count("dress_image")).isZero();
    }
    @Test void manualNullResetVersionAndHistoricalAi() {
        var d=service.create(USER,createBody()); String id=d.getId(), image=d.getImages().getFirst().getId();
        jdbc.update("UPDATE dress_recognition SET status='SUCCEEDED' WHERE id=?",d.getRecognition().getId());
        jdbc.update("UPDATE dress_image SET pattern='AI',recognition_id=? WHERE id=?",d.getRecognition().getId(),image);
        var nullValue=new HashMap<String,Object>(); nullValue.put("pattern",null);
        d=service.manual(USER,id,image,Map.of("version","0","manualFeatures",nullValue));
        assertThat(d.getImages().getFirst().getEffectiveFeatures()).containsEntry("pattern",null);
        error(()->service.manual(USER,id,image,Map.of("version","0","manualFeatures",Map.of("pattern","stale"))),"VERSION_CONFLICT");
        d=service.manual(USER,id,image,Map.of("version","1","resetFeatureKeys",List.of("pattern")));
        assertThat(d.getImages().getFirst().getEffectiveFeatures()).containsEntry("pattern","AI");
        d=service.patch(USER,id,Map.of("images",List.of(Map.of("imageId",d.getImages().get(1).getId()),Map.of("imageId",image))));
        assertThat(d.getImages().get(1).isAiCurrent()).isFalse(); assertThat(d.getImages().get(1).getEffectiveFeatures()).doesNotContainKey("pattern");
        error(()->service.manual(USER,id,image,Map.of("version","2","manualFeatures",Map.of("unrecognized","x"))),"VALIDATION_ERROR");
    }
    @Test void retryRequiresCurrentIdAndConfirmationAndPreservesTerminalHistory() {
        var d=service.create(USER,createBody()); String id=d.getId(), recognition=d.getRecognition().getId();
        error(()->service.retry(USER,id,Map.of("recognitionId",recognition)),"RECOGNITION_UNAVAILABLE"); assertThat(count("dress_recognition")).isEqualTo(1);
        jdbc.update("UPDATE dress_recognition SET status='UNKNOWN',holds_input_assets=1 WHERE id=?",recognition);
        when(availability.available()).thenReturn(true);
        error(()->service.retry(USER,id,Map.of("recognitionId",recognition)),"UNKNOWN_CONFIRMATION_REQUIRED");
        var next=service.retry(USER,id,Map.of("recognitionId",recognition,"confirmUnknown",true)); assertThat(next.getStatus()).isEqualTo("PENDING");
        assertThat(jdbc.queryForObject("SELECT status FROM dress_recognition WHERE id=?",String.class,recognition)).isEqualTo("SUPERSEDED");
        error(()->service.retry(USER,id,Map.of("recognitionId",recognition,"confirmUnknown",true)),"RECOGNITION_NOT_RETRYABLE");
    }
    @Test void concurrentManualWritesOnlyOneWins() throws Exception {
        var d=service.create(USER,createBody()); String id=d.getId(), image=d.getImages().getFirst().getId();
        var ready=new CountDownLatch(4); var start=new CountDownLatch(1);
        try(var pool=Executors.newFixedThreadPool(4)) {
            var jobs=new ArrayList<Future<Boolean>>();
            for(int i=0;i<4;i++) jobs.add(pool.submit(()->{ ready.countDown(); start.await(); try { service.manual(USER,id,image,Map.of("version","0","manualFeatures",Map.of("pattern","manual"))); return true; } catch(ApiException e) { assertThat(e.getCode()).isEqualTo("VERSION_CONFLICT"); return false; } }));
            assertThat(ready.await(10,TimeUnit.SECONDS)).isTrue(); start.countDown(); int success=0; for(var job:jobs) if(job.get(20,TimeUnit.SECONDS))success++; assertThat(success).isEqualTo(1);
        }
        assertThat(service.detail(USER,id).getImages().getFirst().getVersion()).isEqualTo("1");
    }
    @Test void deleteRollsBackOnMidwayFailureAndPreservesHistoricalDesignReference() {
        var d=service.create(USER,createBody());
        jdbc.update("INSERT INTO design_task(id,user_id,client_request_id,design_type,status,request_hash,model_config_snapshot,input_snapshot,created_at,updated_at) VALUES(?,?,'wardrobe-history','OUTFIT','FAILED',REPEAT('0',64),'{}','{}',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",FILE,USER);
        jdbc.update("INSERT INTO design_task_asset(user_id,task_id,asset_id,role,position,source_dress_id,created_at,updated_at) VALUES(?,?,?,'CANDIDATE',0,?,UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))",USER,FILE,FILE,d.getId());
        doThrow(new IllegalStateException("injected")).when(mapper).deleteDress(USER,Long.valueOf(d.getId()));
        assertThatThrownBy(()->service.delete(USER,d.getId())).isInstanceOf(IllegalStateException.class);
        assertThat(count("dress_image")).isEqualTo(2); assertThat(count("dress_recognition")).isEqualTo(1);
        reset(mapper); service.delete(USER,d.getId());
        assertThat(count("dress")).isZero(); assertThat(count("dress_image")).isZero(); assertThat(count("dress_recognition")).isZero();
        assertThat(count("design_task_asset")).isEqualTo(1); assertThat(count("file_asset")).isEqualTo(4);
    }
    @Test void mvcRejectsUnknownFieldsAndStrictTypes() throws Exception {
        var mvc=org.springframework.test.web.servlet.setup.MockMvcBuilders.webAppContextSetup(webContext).build();
        var account=new cc.riskswap.lookmate.dto.AccountDto(Long.toString(USER),"wardrobe_test_901",null);
        for(String body:List.of("{}","{\"name\":12}","{\"name\":\"x\",\"ownerId\":1}","{\"name\":null}","{\"name\":\"x\",\"categoryId\":1,\"images\":[]}"))
            mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/api/dresses")
                    .requestAttr(cc.riskswap.lookmate.security.AuthGuardFilter.ACCOUNT,account)
                    .requestAttr(cc.riskswap.lookmate.api.ApiErrors.REQUEST_ID,"wardrobe-http-test")
                    .contentType("application/json").content(body))
                    .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isBadRequest());
        var d=service.create(USER,createBody());
        for(String body:List.of("{\"seasons\":[null]}","{\"seasons\":[1]}","{\"images\":null}","{\"color\":false}","{\"notes\":[]}"))
            mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch("/api/dresses/"+d.getId())
                    .requestAttr(cc.riskswap.lookmate.security.AuthGuardFilter.ACCOUNT,account)
                    .requestAttr(cc.riskswap.lookmate.api.ApiErrors.REQUEST_ID,"wardrobe-http-test")
                    .contentType("application/json").content(body))
                    .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isBadRequest());
    }
    @Test void concurrentDifferentAccountsCannotExceedGlobalAdmission() throws Exception {
        when(availability.available()).thenReturn(true);
        recognitionProperties.setPendingLimit(1);
        var ready=new CountDownLatch(2); var start=new CountDownLatch(1);
        try(var pool=Executors.newFixedThreadPool(2)) {
            var jobs=new ArrayList<Future<cc.riskswap.lookmate.dto.DressDto>>();
            for(long owner:new long[]{USER,OTHER}) jobs.add(pool.submit(()->{
                ready.countDown(); start.await();
                return service.create(owner,Map.of("name","capacity","categoryId",service.categories().getFirst().getId(),
                        "images",List.of(Map.of("fileId",Long.toString(owner==USER?FILE:FILE+4)))));
            }));
            assertThat(ready.await(10,TimeUnit.SECONDS)).isTrue(); start.countDown();
            var results=new ArrayList<cc.riskswap.lookmate.dto.DressDto>();
            for(var job:jobs) results.add(job.get(20,TimeUnit.SECONDS));
            assertThat(results).extracting(d->d.getRecognition().getStatus()).containsExactlyInAnyOrder("PENDING","FAILED");
            var failed=results.stream().filter(d->"FAILED".equals(d.getRecognition().getStatus())).findFirst().orElseThrow();
            assertThat(failed.getRecognition().getErrorCode()).isEqualTo("RECOGNITION_CAPACITY_EXCEEDED");
            assertThat(jdbc.queryForObject("SELECT holds_input_assets FROM dress_recognition WHERE id=?",Integer.class,failed.getRecognition().getId())).isZero();
        }
    }
    @Test void accountCapacityAndRetryRollbackKeepUnknownReferences() {
        when(availability.available()).thenReturn(true);
        recognitionProperties.setUserPendingLimit(1);
        var pending=service.create(USER,createBody());
        var failed=service.create(USER,Map.of("name","second","categoryId",pending.getCategoryId(),"images",List.of(Map.of("fileId",""+(FILE+2)))));
        assertThat(failed.getRecognition().getErrorCode()).isEqualTo("RECOGNITION_CAPACITY_EXCEEDED");
        String recognition=failed.getRecognition().getId();
        jdbc.update("UPDATE dress_recognition SET status='UNKNOWN',holds_input_assets=1,attempt_token='retain-me' WHERE id=?",recognition);
        error(()->service.retry(USER,failed.getId(),Map.of("recognitionId",recognition,"confirmUnknown",true)),"RECOGNITION_CAPACITY_EXCEEDED");
        assertThat(count("dress_recognition")).isEqualTo(2);
        assertThat(jdbc.queryForMap("SELECT status,holds_input_assets,attempt_token FROM dress_recognition WHERE id=?",recognition))
                .containsEntry("status","UNKNOWN").containsEntry("holds_input_assets",1).containsEntry("attempt_token","retain-me");
        jdbc.update("UPDATE dress_recognition SET status='FAILED',holds_input_assets=0 WHERE id=?",pending.getRecognition().getId());
        assertThat(service.retry(USER,failed.getId(),Map.of("recognitionId",recognition,"confirmUnknown",true)).getStatus()).isEqualTo("PENDING");
    }
    private long count(String table) { return jdbc.queryForObject("SELECT COUNT(*) FROM "+table+" WHERE user_id=?",Long.class,USER); }
}
