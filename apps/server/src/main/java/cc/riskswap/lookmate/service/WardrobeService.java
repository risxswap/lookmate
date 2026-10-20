package cc.riskswap.lookmate.service;

import java.time.*;
import java.util.*;
import java.util.stream.Collectors;
import cc.riskswap.lookmate.api.ApiException;
import cc.riskswap.lookmate.dto.*;
import cc.riskswap.lookmate.entity.*;
import cc.riskswap.lookmate.mapper.DressMapper;
import cc.riskswap.lookmate.param.*;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;
import tools.jackson.databind.json.JsonMapper;

@Service
@RequiredArgsConstructor
public class WardrobeService {
    private static final List<String> SEASONS=List.of("SPRING","SUMMER","AUTUMN","WINTER");
    private static final Set<String> FIELDS=Set.of("name","categoryId","color","seasons","notes","images");
    private final DressMapper mapper;
    private final RecognitionAvailability availability;
    private final RecognitionAdmission admission;
    private final JsonMapper json;

    public List<DressCategoryDto> categories() { return mapper.categories(); }
    @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
    public PageDto<DressDto> list(Long user,String pageValue,String sizeValue,String categoryValue) {
        int page=RecordParameters.page(pageValue,1,Integer.MAX_VALUE), size=RecordParameters.page(sizeValue,20,100);
        Long category=categoryValue==null?null:RecordParameters.id(categoryValue);
        if(category!=null) category(category);
        var rows=mapper.list(user,category,size,((long)page-1)*size);
        var ids=rows.stream().map(DressRow::getId).toList();
        if(ids.isEmpty()) return new PageDto<>(List.of(),page,size,mapper.count(user,category));
        var images=mapper.images(user,ids).stream().collect(Collectors.groupingBy(DressImageRow::getDressId));
        var recognitions=mapper.recognitions(user,ids).stream().collect(Collectors.toMap(DressRecognitionRow::getDressId,r->r));
        return new PageDto<>(rows.stream().map(r->dto(r,images.getOrDefault(r.getId(),List.of()),recognitions.get(r.getId()))).toList(),page,size,mapper.count(user,category));
    }
    @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
    public DressDto detail(Long user,String id) { return detail(user,require(user,RecordParameters.id(id))); }
    @Transactional(isolation=Isolation.READ_COMMITTED)
    public DressDto create(Long user,Map<String,Object> body) {
        fields(body,FIELDS);
        if(!body.keySet().containsAll(Set.of("name","categoryId","images"))) throw DressFeatures.invalid();
        lock(user);
        var row=new DressRow(); row.setUserId(user); row.setSeasonMask(0); row.setImageRevision(1L);
        apply(row,body); mapper.create(row);
        saveImages(row,List.of(),body.get("images"),true);
        createRecognition(row,1,false);
        return detail(user,require(user,row.getId()));
    }
    @Transactional(isolation=Isolation.READ_COMMITTED)
    public DressDto patch(Long user,String id,Map<String,Object> body) {
        fields(body,FIELDS); lock(user); var row=lockDress(user,RecordParameters.id(id));
        apply(row,body);
        boolean changed=false;
        if(body.containsKey("images")) changed=saveImages(row,mapper.images(user,List.of(row.getId())),body.get("images"),false);
        if(changed) {
            if(row.getImageRevision()==Long.MAX_VALUE) throw new ApiException(409,"VERSION_CONFLICT","图片集合版本已达上限");
            row.setImageRevision(row.getImageRevision()+1);
        }
        mapper.update(row);
        if(changed) { mapper.supersede(user,row.getId()); createRecognition(row,1,false); }
        return detail(user,require(user,row.getId()));
    }
    @Transactional
    public void delete(Long user,String id) {
        lock(user); var row=lockDress(user,RecordParameters.id(id)); var images=mapper.images(user,List.of(row.getId()));
        mapper.supersede(user,row.getId()); mapper.deleteCalls(user,row.getId()); mapper.deleteRecognitions(user,row.getId());
        for(var image:images) mapper.deleteImage(user,image.getId());
        mapper.deleteDress(user,row.getId());
        for(Long asset:images.stream().map(DressImageRow::getAssetId).sorted().toList()) { mapper.file(user,asset); mapper.scheduleCleanup(user,asset); }
    }
    @Transactional
    public DressDto manual(Long user,String id,String imageId,Map<String,Object> body) {
        fields(body,Set.of("version","manualFeatures","resetFeatureKeys"));
        Long version=version(body.get("version"));
        lock(user); var row=lockDress(user,RecordParameters.id(id));
        var image=mapper.images(user,List.of(row.getId())).stream().filter(i->i.getId().equals(RecordParameters.id(imageId))).findFirst()
                .orElseThrow(()->new ApiException(404,"DRESS_IMAGE_NOT_FOUND","衣物图片不存在"));
        if(!version.equals(image.getVersion()) || version==Long.MAX_VALUE) throw conflict();
        Map<String,Object> updates=body.containsKey("manualFeatures")?DressFeatures.validate(object(body.get("manualFeatures"))):Map.of();
        var values=objectJson(image.getManualFeatures()); values.putAll(updates);
        if(body.containsKey("resetFeatureKeys")) {
            if(!(body.get("resetFeatureKeys") instanceof List<?> keys) || new HashSet<>(keys).size()!=keys.size()) throw DressFeatures.invalid();
            for(Object key:keys) { if(!(key instanceof String k)||!DressFeatures.KEYS.contains(k)||updates.containsKey(k)) throw DressFeatures.invalid(); values.remove(k); }
        }
        if(mapper.manual(user,image.getId(),version,json.writeValueAsString(values))!=1) throw conflict();
        return detail(user,row);
    }
    @Transactional(isolation=Isolation.READ_COMMITTED)
    public DressRecognitionDto retry(Long user,String id,Map<String,Object> body) {
        fields(body,Set.of("recognitionId","confirmUnknown"));
        Long target=RecordParameters.id(DressFeatures.text(body.get("recognitionId"),19,false));
        if(body.containsKey("confirmUnknown") && !(body.get("confirmUnknown") instanceof Boolean)) throw DressFeatures.invalid();
        lock(user); var row=lockDress(user,RecordParameters.id(id)); var latest=mapper.recognition(user,row.getId(),row.getImageRevision());
        if(latest==null || !latest.getId().equals(target) || !Set.of("FAILED","UNKNOWN").contains(latest.getStatus()) || latest.getAttemptNo()==Integer.MAX_VALUE)
            throw new ApiException(409,"RECOGNITION_NOT_RETRYABLE","当前识别任务不可重试");
        if("UNKNOWN".equals(latest.getStatus()) && !Boolean.TRUE.equals(body.get("confirmUnknown"))) throw new ApiException(409,"UNKNOWN_CONFIRMATION_REQUIRED","旧调用可能仍在执行，请确认后重试");
        if(!availability.available()) throw new ApiException(503,"RECOGNITION_UNAVAILABLE","衣物识别服务尚未配置");
        for(Long asset:mapper.images(user,List.of(row.getId())).stream().map(DressImageRow::getAssetId).sorted().toList()) requireFile(user,asset);
        mapper.supersede(user,row.getId()); createRecognition(row,latest.getAttemptNo()+1,true);
        return recognitionDto(mapper.recognition(user,row.getId(),row.getImageRevision()));
    }
    private void apply(DressRow row,Map<String,Object> body) {
        if(body.containsKey("name")) { String name=trim(DressFeatures.text(body.get("name"),1000,false)); if(name.isEmpty()||name.codePointCount(0,name.length())>100) throw DressFeatures.invalid(); row.setName(name); }
        if(body.containsKey("categoryId")) { Long category=RecordParameters.id(DressFeatures.text(body.get("categoryId"),19,false)); category(category); row.setCategoryId(category); }
        if(body.containsKey("color")) row.setColor(DressFeatures.text(body.get("color"),100,true));
        if(body.containsKey("notes")) row.setNotes(DressFeatures.text(body.get("notes"),1000,true));
        if(body.containsKey("seasons")) {
            if(!(body.get("seasons") instanceof List<?> seasons)||seasons.size()!=new HashSet<>(seasons).size()||seasons.stream().anyMatch(s->!(s instanceof String)||!SEASONS.contains(s))) throw DressFeatures.invalid();
            int mask=0; for(Object s:seasons) mask|=1<<SEASONS.indexOf(s); row.setSeasonMask(mask);
        }
    }
    private boolean saveImages(DressRow row,List<DressImageRow> old,Object raw,boolean creating) {
        if(!(raw instanceof List<?> input)||input.isEmpty()) throw DressFeatures.invalid();
        var byId=old.stream().collect(Collectors.toMap(DressImageRow::getId,i->i));
        var next=new ArrayList<DressImageRow>(); var assets=new HashSet<Long>(); var kept=new HashSet<Long>();
        for(Object value:input) {
            var item=object(value); fields(item,creating?Set.of("fileId"):Set.of("fileId","imageId"));
            if(item.size()!=1) throw DressFeatures.invalid();
            DressImageRow image;
            if(item.containsKey("imageId")) {
                Long imageId=RecordParameters.id(DressFeatures.text(item.get("imageId"),19,false)); image=byId.get(imageId);
                if(image==null) throw new ApiException(404,"DRESS_IMAGE_NOT_FOUND","衣物图片不存在"); kept.add(imageId);
            } else {
                image=new DressImageRow(); image.setUserId(row.getUserId()); image.setDressId(row.getId());
                image.setAssetId(RecordParameters.id(DressFeatures.text(item.get("fileId"),19,false)));
                // A file already in this dress must retain its immutable image identity.
                if(old.stream().anyMatch(i->i.getAssetId().equals(image.getAssetId()))) throw DressFeatures.invalid();
            }
            if(!assets.add(image.getAssetId())) throw DressFeatures.invalid(); next.add(image);
        }
        // All file locks follow business locks and have a stable order.
        var allAssets=new TreeSet<Long>(assets); old.forEach(i->allAssets.add(i.getAssetId()));
        for(Long asset:allAssets) {
            if(assets.contains(asset)) { requireFile(row.getUserId(),asset); mapper.bindFile(row.getUserId(),asset); }
            else mapper.file(row.getUserId(),asset);
        }
        boolean changed=old.size()!=next.size();
        for(int i=0;i<next.size();i++) if(i>=old.size()||!Objects.equals(next.get(i).getId(),old.get(i).getId())) changed=true;
        for(var image:old) if(!kept.contains(image.getId())) { mapper.deleteImage(row.getUserId(),image.getId()); mapper.scheduleCleanup(row.getUserId(),image.getAssetId()); }
        for(int i=0;i<next.size();i++) { var image=next.get(i); image.setSortOrder(i); if(image.getId()==null) mapper.createImage(image); else mapper.orderImage(image); }
        return changed;
    }
    private void requireFile(Long user,Long asset) {
        var file=mapper.file(user,asset);
        if(file==null) throw new ApiException(404,"FILE_NOT_FOUND","图片文件不存在");
        if(!Set.of("TEMP","READY").contains(file.getStatus()) || "TEMP".equals(file.getStatus()) && file.getExpiresAt()==null || file.isExpired()
                || file.getMimeType()==null || !Set.of("image/jpeg","image/png","image/webp").contains(file.getMimeType())
                || file.getWidth()==null || file.getWidth()<1 || file.getHeight()==null || file.getHeight()<1
                || (long)file.getWidth()*file.getHeight()>25_000_000L || file.getSizeBytes()==null || file.getSizeBytes()<1 || file.getSizeBytes()>20L*1024*1024)
            throw new ApiException(409,"FILE_NOT_USABLE","图片尚未就绪或已过期");
    }
    private DressRow lockDress(Long user,Long id) {
        if(mapper.lockDress(user,id)==null) throw new ApiException(404,"DRESS_NOT_FOUND","衣物不存在");
        mapper.lockImages(user,id); mapper.lockRecognitions(user,id); mapper.lockCalls(user,id);
        return require(user,id);
    }
    private void createRecognition(DressRow row,int attempt,boolean retry) {
        Map<String,Object> info=new LinkedHashMap<>(); info.put("id",row.getId().toString()); info.put("name",row.getName()); info.put("categoryId",row.getCategoryId().toString()); info.put("color",row.getColor()); info.put("seasons",seasons(row.getSeasonMask())); info.put("notes",row.getNotes());
        var images=mapper.images(row.getUserId(),List.of(row.getId())).stream().map(i->Map.of("imageId",i.getId().toString(),"assetId",i.getAssetId().toString(),"sortOrder",i.getSortOrder())).toList();
        boolean available=availability.available();
        boolean admitted=available && admission.acquire(row.getUserId());
        if(available && !admitted && retry) throw new ApiException(503,"RECOGNITION_CAPACITY_EXCEEDED","识别队列已满，请稍后重试");
        String code=!available?"RECOGNITION_UNAVAILABLE":!admitted?"RECOGNITION_CAPACITY_EXCEEDED":null;
        String message=!available?"衣物识别服务尚未配置":!admitted?"识别队列已满，请稍后重试":null;
        mapper.createRecognition(row.getUserId(),row.getId(),row.getImageRevision(),attempt,admitted?"PENDING":"FAILED",json.writeValueAsString(Map.of("schemaVersion",1,"dress",info,"images",images)),availability.configSnapshot(),admitted?1:0,code,message);
    }
    private DressDto detail(Long user,DressRow row) { return dto(row,mapper.images(user,List.of(row.getId())),mapper.recognition(user,row.getId(),row.getImageRevision())); }
    private DressDto dto(DressRow r,List<DressImageRow> images,DressRecognitionRow recognition) {
        var d=new DressDto(); d.setId(r.getId().toString()); d.setName(r.getName()); d.setCategoryId(r.getCategoryId().toString()); d.setColor(r.getColor()); d.setNotes(r.getNotes()); d.setSeasons(seasons(r.getSeasonMask())); d.setImageRevision(r.getImageRevision().toString()); d.setCreatedAt(utc(r.getCreatedAt())); d.setUpdatedAt(utc(r.getUpdatedAt())); d.setRecognition(recognitionDto(recognition));
        d.setImages(images.stream().map(i->{ var x=new DressImageDto(); x.setId(i.getId().toString()); x.setFileId(i.getAssetId().toString()); x.setSortOrder(i.getSortOrder()); x.setVersion(i.getVersion().toString()); x.setRecognitionId(i.getRecognitionId()==null?null:i.getRecognitionId().toString());
            var ai=new LinkedHashMap<String,Object>(); ai.put("viewType",i.getViewType()); ai.put("description",i.getDescription()); ai.put("colors",parse(i.getColors())); ai.put("pattern",i.getPattern()); ai.put("styleTags",parse(i.getStyleTags())); ai.put("fit",i.getFit()); ai.put("materialDescription",i.getMaterialDescription()); ai.put("details",parse(i.getDetails()));
            boolean current=i.getRecognitionId()!=null && Objects.equals(i.getRecognitionRevision(),r.getImageRevision()) && recognition!=null && Objects.equals(i.getRecognitionId(),recognition.getId()) && "SUCCEEDED".equals(recognition.getStatus());
            var manual=objectJson(i.getManualFeatures()); var effective=new LinkedHashMap<String,Object>(); if(current) effective.putAll(ai); effective.putAll(manual); x.setAiCurrent(current); x.setAiFeatures(ai); x.setManualFeatures(manual); x.setEffectiveFeatures(effective); return x; }).toList()); return d;
    }
    private DressRecognitionDto recognitionDto(DressRecognitionRow r) { if(r==null)return null; var x=new DressRecognitionDto(); x.setId(r.getId().toString()); x.setStatus(r.getStatus()); x.setErrorCode(r.getErrorCode()); x.setErrorMessage(r.getErrorMessage()); x.setCreatedAt(utc(r.getCreatedAt())); x.setUpdatedAt(utc(r.getUpdatedAt())); return x; }
    private Object parse(String value) { return value==null?null:json.readValue(value,Object.class); }
    private Map<String,Object> objectJson(String value) { return value==null?new LinkedHashMap<>():new LinkedHashMap<>(object(parse(value))); }
    @SuppressWarnings("unchecked") private static Map<String,Object> object(Object value) { if(!(value instanceof Map<?,?> map)||map.keySet().stream().anyMatch(k->!(k instanceof String))) throw DressFeatures.invalid(); return (Map<String,Object>)map; }
    private static void fields(Map<String,Object> body,Set<String> allowed) { if(body==null||!allowed.containsAll(body.keySet())) throw DressFeatures.invalid(); }
    private static Long version(Object raw) { String s=DressFeatures.text(raw,19,false); if(!s.matches("[0-9]{1,19}")) throw DressFeatures.invalid(); try{return Long.valueOf(s);}catch(NumberFormatException e){throw DressFeatures.invalid();} }
    private void lock(Long user) { if(mapper.lockUser(user)==null) throw new ApiException(401,"UNAUTHENTICATED","请先登录"); }
    private DressRow require(Long user,Long id) { var row=mapper.dress(user,id); if(row==null) throw new ApiException(404,"DRESS_NOT_FOUND","衣物不存在"); return row; }
    private void category(Long id) { if(mapper.category(id)==null) throw new ApiException(404,"CATEGORY_NOT_FOUND","分类不存在"); }
    private static List<String> seasons(int mask) { var result=new ArrayList<String>(); for(int i=0;i<4;i++) if((mask&(1<<i))!=0) result.add(SEASONS.get(i)); return result; }
    private static String utc(LocalDateTime t) { return t.toInstant(ZoneOffset.UTC).toString(); }
    private static String trim(String s) { return s.replaceAll("^[\\s\\p{Z}\\u0085\\u001c-\\u001f]+|[\\s\\p{Z}\\u0085\\u001c-\\u001f]+$",""); }
    private static ApiException conflict() { return new ApiException(409,"VERSION_CONFLICT","图片特征已更新，请刷新后重试"); }
}
