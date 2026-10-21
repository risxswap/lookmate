package cc.riskswap.lookmate.service;

import java.time.*;
import java.util.*;
import cc.riskswap.lookmate.api.ApiException;
import cc.riskswap.lookmate.dto.*;
import cc.riskswap.lookmate.entity.*;
import cc.riskswap.lookmate.mapper.*;
import cc.riskswap.lookmate.param.*;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;

@Service
@RequiredArgsConstructor
public class ProfileService {
    private static final Set<String> PHOTO_TYPES=Set.of("PORTRAIT","FULL_BODY","REFERENCE");
    private final ProfileMapper mapper;
    private final PreferenceMapper preferences;
    private final FileMapper files;
    private final DressMapper assets;

    @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
    public ProfileDto get(Long user) { return dto(requireProfile(user)); }

    @Transactional(isolation=Isolation.READ_COMMITTED)
    public ProfileDto patch(Long user,Map<String,Object> body) {
        ProfileParameters.fields(body,Set.of("version","displayName","gender","birthDate"));
        var row=edit(user,body);
        if(body.containsKey("displayName")) {
            Object raw=body.get("displayName");
            if(raw==null) row.setDisplayName(null);
            else {
                if(!(raw instanceof String name)) throw ProfileParameters.invalid();
                name=name.replaceAll("^[\\s\\p{Z}\\u0085\\u001c-\\u001f]+|[\\s\\p{Z}\\u0085\\u001c-\\u001f]+$","");
                if(name.isEmpty() || name.codePointCount(0,name.length())>64) throw ProfileParameters.invalid();
                row.setDisplayName(name);
            }
        }
        if(body.containsKey("gender")) row.setGender(ProfileParameters.gender(body.get("gender"),false));
        if(body.containsKey("birthDate")) row.setBirthDate(ProfileParameters.birthDate(body.get("birthDate"),Clock.systemUTC()));
        return save(row);
    }

    @Transactional(isolation=Isolation.READ_COMMITTED)
    public ProfileDto preferences(Long user, Map<String,Object> body) {
        var patch = PreferenceParameters.patch(body);
        var profile = edit(user,body);
        var existing = preferences.get(user);
        var merged = PreferenceParameters.values(existing);
        merged.putAll(patch);
        PreferenceParameters.validateMerged(merged);
        var row = PreferenceParameters.row(user,merged);
        if(existing == null) preferences.create(row); else preferences.update(row);
        return save(profile);
    }

    @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
    public PageDto<MeasurementDto> measurements(Long user,String pageValue,String sizeValue) {
        int page=RecordParameters.page(pageValue,1,Integer.MAX_VALUE), size=RecordParameters.page(sizeValue,20,100);
        var profile=requireProfile(user);
        return new PageDto<>(mapper.measurements(user,size,((long)page-1)*size).stream()
                .map(row->measurementDto(row,profile.getCurrentMeasurementId())).toList(),page,size,mapper.measurementCount(user));
    }

    @Transactional(isolation=Isolation.READ_COMMITTED)
    public MeasurementSaveDto createMeasurement(Long user,Map<String,Object> body) {
        var allowed=new HashSet<>(ProfileParameters.MEASUREMENTS); allowed.add("version"); allowed.add("gender");
        ProfileParameters.fields(body,allowed);
        String gender=ProfileParameters.gender(body.get("gender"),true);
        var profile=edit(user,body);
        profile.setGender(gender);
        var row=new MeasurementRow(); row.setUserId(user);
        row.setHeight(ProfileParameters.measurement(body.get("height")));
        row.setWeight(ProfileParameters.measurement(body.get("weight")));
        row.setNeck(ProfileParameters.measurement(body.get("neck")));
        row.setChest(ProfileParameters.measurement(body.get("chest")));
        row.setUnderbust(ProfileParameters.measurement(body.get("underbust")));
        row.setWaist(ProfileParameters.measurement(body.get("waist")));
        row.setAbdomen(ProfileParameters.measurement(body.get("abdomen")));
        row.setHip(ProfileParameters.measurement(body.get("hip")));
        row.setShoulder(ProfileParameters.measurement(body.get("shoulder")));
        row.setBackWidth(ProfileParameters.measurement(body.get("backWidth")));
        row.setArmLength(ProfileParameters.measurement(body.get("armLength")));
        row.setUpperArm(ProfileParameters.measurement(body.get("upperArm")));
        row.setForearm(ProfileParameters.measurement(body.get("forearm")));
        row.setWrist(ProfileParameters.measurement(body.get("wrist")));
        row.setFrontWaistLength(ProfileParameters.measurement(body.get("frontWaistLength")));
        row.setBackWaistLength(ProfileParameters.measurement(body.get("backWaistLength")));
        row.setInseam(ProfileParameters.measurement(body.get("inseam")));
        row.setOutseam(ProfileParameters.measurement(body.get("outseam")));
        row.setThigh(ProfileParameters.measurement(body.get("thigh")));
        row.setKnee(ProfileParameters.measurement(body.get("knee")));
        row.setCalf(ProfileParameters.measurement(body.get("calf")));
        row.setAnkle(ProfileParameters.measurement(body.get("ankle")));
        row.setHead(ProfileParameters.measurement(body.get("head")));
        row.setLeftFootLength(ProfileParameters.measurement(body.get("leftFootLength")));
        row.setRightFootLength(ProfileParameters.measurement(body.get("rightFootLength")));
        row.setLeftFootWidth(ProfileParameters.measurement(body.get("leftFootWidth")));
        row.setRightFootWidth(ProfileParameters.measurement(body.get("rightFootWidth")));
        mapper.createMeasurement(row);
        profile.setCurrentMeasurementId(row.getId());
        var result=new MeasurementSaveDto(); result.setProfile(save(profile));
        result.setMeasurement(result.getProfile().getCurrentMeasurement());
        return result;
    }

    @Transactional(isolation=Isolation.READ_COMMITTED)
    public ProfileDto currentMeasurement(Long user,Map<String,Object> body) {
        ProfileParameters.fields(body,Set.of("version","measurementId"));
        if(!body.containsKey("measurementId")) throw ProfileParameters.invalid();
        var profile=edit(user,body);
        Long id=body.get("measurementId")==null?null:ProfileParameters.id(body.get("measurementId"));
        if(id!=null) requireMeasurement(user,id);
        profile.setCurrentMeasurementId(id);
        return save(profile);
    }

    @Transactional(isolation=Isolation.READ_COMMITTED)
    public void deleteMeasurement(Long user,String idValue,Map<String,Object> body) {
        ProfileParameters.fields(body,Set.of("version"));
        Long id=RecordParameters.id(idValue);
        var profile=edit(user,body); requireMeasurement(user,id);
        if(Objects.equals(profile.getCurrentMeasurementId(),id)) profile.setCurrentMeasurementId(null);
        mapper.deleteMeasurement(user,id);
        save(profile);
    }

    @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
    public PageDto<PhotoDto> photos(Long user,String pageValue,String sizeValue,String type) {
        int page=RecordParameters.page(pageValue,1,Integer.MAX_VALUE), size=RecordParameters.page(sizeValue,20,100);
        if(type!=null) photoType(type);
        return new PageDto<>(mapper.photos(user,type,size,((long)page-1)*size).stream().map(this::photoDto).toList(),page,size,mapper.photoCount(user,type));
    }

    @Transactional(isolation=Isolation.READ_COMMITTED)
    public PhotoDto createPhoto(Long user,Map<String,Object> body) {
        ProfileParameters.fields(body,Set.of("fileId","photoType"));
        Long asset=ProfileParameters.id(body.get("fileId")); String type=photoType(body.get("photoType"));
        lock(user);
        var file=files.lock(user,asset);
        if(file==null) throw new ApiException(404,"FILE_NOT_FOUND","图片文件不存在");
        if(!Set.of("TEMP","READY").contains(file.getStatus()) || file.getCleanupAfter()!=null
                || "TEMP".equals(file.getStatus()) && file.getExpiresAt()==null
                || file.getExpiresAt()!=null && !file.getExpiresAt().isAfter(file.getDbNow())
                || file.getMimeType()==null || !Set.of("image/jpeg","image/png","image/webp").contains(file.getMimeType())
                || file.getWidth()==null || file.getWidth()<1 || file.getHeight()==null || file.getHeight()<1
                || (long)file.getWidth()*file.getHeight()>25_000_000L || file.getSizeBytes()==null || file.getSizeBytes()<1 || file.getSizeBytes()>20L*1024*1024)
            throw new ApiException(409,"FILE_NOT_USABLE","图片尚未就绪、已过期或待清理");
        var row=new PhotoRow(); row.setUserId(user); row.setAssetId(asset); row.setPhotoType(type);
        mapper.createPhoto(row); assets.bindFile(user,asset);
        return photoDto(requirePhoto(user,row.getId()));
    }

    @Transactional(isolation=Isolation.READ_COMMITTED)
    public ProfileDto defaultPhotos(Long user,Map<String,Object> body) {
        ProfileParameters.fields(body,Set.of("version","portraitId","fullBodyId"));
        var profile=edit(user,body);
        if(body.containsKey("portraitId")) profile.setDefaultPortraitId(defaultPhoto(user,body.get("portraitId"),"PORTRAIT"));
        if(body.containsKey("fullBodyId")) profile.setDefaultFullBodyId(defaultPhoto(user,body.get("fullBodyId"),"FULL_BODY"));
        return save(profile);
    }

    @Transactional(isolation=Isolation.READ_COMMITTED)
    public void deletePhoto(Long user,String idValue,Map<String,Object> body) {
        ProfileParameters.fields(body,Set.of("version"));
        Long id=RecordParameters.id(idValue);
        var profile=edit(user,body); var photo=requirePhoto(user,id);
        if(Objects.equals(profile.getDefaultPortraitId(),id)) profile.setDefaultPortraitId(null);
        if(Objects.equals(profile.getDefaultFullBodyId(),id)) profile.setDefaultFullBodyId(null);
        mapper.deletePhoto(user,id);
        files.lock(user,photo.getAssetId()); assets.scheduleCleanup(user,photo.getAssetId());
        save(profile);
    }

    private Long defaultPhoto(Long user,Object value,String type) {
        if(value==null) return null;
        Long id=ProfileParameters.id(value);
        if(!type.equals(requirePhoto(user,id).getPhotoType())) throw ProfileParameters.invalid();
        return id;
    }
    private String photoType(Object value) {
        if(!(value instanceof String type) || !PHOTO_TYPES.contains(type)) throw ProfileParameters.invalid();
        return type;
    }
    private ProfileRow requireProfile(Long user) {
        var row=mapper.profile(user); if(row==null) throw new ApiException(401,"UNAUTHENTICATED","请先登录"); return row;
    }
    private ProfileRow lock(Long user) {
        var row=mapper.lockUser(user); if(row==null) throw new ApiException(401,"UNAUTHENTICATED","请先登录"); return row;
    }
    private ProfileRow edit(Long user,Map<String,Object> body) {
        Long version=ProfileParameters.version(body.get("version")); var row=lock(user);
        if(!version.equals(row.getVersion()) || version==Long.MAX_VALUE) throw conflict();
        return row;
    }
    private ProfileDto save(ProfileRow row) {
        if(mapper.update(row)!=1) throw conflict();
        row.setVersion(row.getVersion()+1); return dto(row);
    }
    private MeasurementRow requireMeasurement(Long user,Long id) {
        var row=mapper.measurement(user,id); if(row==null) throw new ApiException(404,"MEASUREMENT_NOT_FOUND","尺寸记录不存在"); return row;
    }
    private PhotoRow requirePhoto(Long user,Long id) {
        var row=mapper.photo(user,id); if(row==null) throw new ApiException(404,"PHOTO_NOT_FOUND","照片不存在"); return row;
    }
    private ProfileDto dto(ProfileRow row) {
        var dto=new ProfileDto(); dto.setId(id(row.getId())); dto.setUsername(row.getUsername()); dto.setDisplayName(row.getDisplayName());
        dto.setGender(row.getGender()); dto.setBirthDate(row.getBirthDate()==null?null:row.getBirthDate().toString());
        var preference=preferences.get(row.getId()); dto.setPreferences(preference==null?null:PreferenceParameters.values(preference));
        dto.setVersion(id(row.getVersion())); dto.setCurrentMeasurementId(id(row.getCurrentMeasurementId()));
        dto.setDefaultPortraitId(id(row.getDefaultPortraitId())); dto.setDefaultFullBodyId(id(row.getDefaultFullBodyId()));
        if(row.getCurrentMeasurementId()!=null) dto.setCurrentMeasurement(measurementDto(requireMeasurement(row.getId(),row.getCurrentMeasurementId()),row.getCurrentMeasurementId()));
        return dto;
    }
    private MeasurementDto measurementDto(MeasurementRow row,Long current) {
        var dto=new MeasurementDto(); dto.setId(id(row.getId())); dto.setCreatedAt(utc(row.getCreatedAt())); dto.setUpdatedAt(utc(row.getUpdatedAt()));
        dto.setCurrent(Objects.equals(row.getId(),current));
        dto.setHeight(row.getHeight());
        dto.setWeight(row.getWeight());
        dto.setNeck(row.getNeck());
        dto.setChest(row.getChest());
        dto.setUnderbust(row.getUnderbust());
        dto.setWaist(row.getWaist());
        dto.setAbdomen(row.getAbdomen());
        dto.setHip(row.getHip());
        dto.setShoulder(row.getShoulder());
        dto.setBackWidth(row.getBackWidth());
        dto.setArmLength(row.getArmLength());
        dto.setUpperArm(row.getUpperArm());
        dto.setForearm(row.getForearm());
        dto.setWrist(row.getWrist());
        dto.setFrontWaistLength(row.getFrontWaistLength());
        dto.setBackWaistLength(row.getBackWaistLength());
        dto.setInseam(row.getInseam());
        dto.setOutseam(row.getOutseam());
        dto.setThigh(row.getThigh());
        dto.setKnee(row.getKnee());
        dto.setCalf(row.getCalf());
        dto.setAnkle(row.getAnkle());
        dto.setHead(row.getHead());
        dto.setLeftFootLength(row.getLeftFootLength());
        dto.setRightFootLength(row.getRightFootLength());
        dto.setLeftFootWidth(row.getLeftFootWidth());
        dto.setRightFootWidth(row.getRightFootWidth());
        return dto;
    }
    private PhotoDto photoDto(PhotoRow row) {
        var dto=new PhotoDto(); dto.setId(id(row.getId())); dto.setFileId(id(row.getAssetId())); dto.setPhotoType(row.getPhotoType());
        dto.setCreatedAt(utc(row.getCreatedAt())); dto.setUpdatedAt(utc(row.getUpdatedAt())); return dto;
    }
    private static String id(Long id) { return id==null?null:id.toString(); }
    private static String utc(LocalDateTime date) { return date.toInstant(ZoneOffset.UTC).toString(); }
    private static ApiException conflict() { return new ApiException(409,"VERSION_CONFLICT","个人资料已更新或版本已达上限，请刷新比较后重试"); }
}
