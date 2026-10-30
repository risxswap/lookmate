package cc.riskswap.lookmate.dao.mapper;

import cc.riskswap.lookmate.dao.entity.AuthTicketRow;
import org.apache.ibatis.annotations.*;

@Mapper
public interface AuthTicketMapper {
    @Insert(
            "INSERT IGNORE INTO auth_ticket(ticket_key,kind,payload,status,expires_at,created_at,updated_at) VALUES(#{key},'OWNER','{}','PENDING',DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 30 DAY),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
    void ensureOwner(String key);

    @Insert(
            "INSERT INTO auth_ticket(ticket_key,kind,owner_hash,payload,status,expires_at,created_at,updated_at) VALUES(#{ticketKey},#{kind},#{ownerHash},#{payload},#{status},#{expiresAt},UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))")
    void insert(AuthTicketRow row);

    @Select("SELECT * FROM auth_ticket WHERE ticket_key=#{key}")
    AuthTicketRow find(String key);

    @Select("SELECT * FROM auth_ticket WHERE ticket_key=#{key} FOR UPDATE")
    AuthTicketRow lock(String key);

    @Update(
            "UPDATE auth_ticket SET status=#{status},payload=#{payload},updated_at=UTC_TIMESTAMP(3) WHERE ticket_key=#{ticketKey}")
    void update(AuthTicketRow row);

    @Update(
            "UPDATE auth_ticket SET status='EXPIRED',updated_at=UTC_TIMESTAMP(3) WHERE owner_hash=#{owner} AND kind='QR' AND status IN ('PENDING','CONFIRMED')")
    void expireOwner(String owner);

    @Delete(
            "DELETE FROM auth_ticket WHERE expires_at < DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 DAY) LIMIT 1000")
    void cleanup();
}
