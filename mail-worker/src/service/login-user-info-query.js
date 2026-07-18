import { permConst } from '../const/entity-const'

function firstResult(batchResult) {
  return batchResult?.results?.[0] || null
}

function resultRows(batchResult) {
  return Array.isArray(batchResult?.results) ? batchResult.results : []
}

export async function selectLoginUserContext(c, userId) {
  const userStatement = c.env.db.prepare(`
    SELECT
      user_id AS userId,
      email,
      type,
      send_count AS sendCount
    FROM user
    WHERE user_id = ? AND is_del = 0
    LIMIT 1
  `).bind(userId)

  const accountStatement = c.env.db.prepare(`
    SELECT
      a.account_id AS accountId,
      a.email,
      a.name,
      a.status,
      a.latest_email_time AS latestEmailTime,
      a.create_time AS createTime,
      a.user_id AS userId,
      a.all_receive AS allReceive,
      a.sort,
      a.is_del AS isDel
    FROM account a
    JOIN user u ON u.email COLLATE NOCASE = a.email COLLATE NOCASE
    WHERE u.user_id = ? AND u.is_del = 0
    LIMIT 1
  `).bind(userId)

  const roleStatement = c.env.db.prepare(`
    SELECT
      r.role_id AS roleId,
      r.name,
      r.key,
      r.description,
      r.ban_email AS banEmail,
      r.ban_email_type AS banEmailType,
      r.avail_domain AS availDomain,
      r.sort,
      r.is_default AS isDefault,
      r.create_time AS createTime,
      r.user_id AS userId,
      r.send_count AS sendCount,
      r.send_type AS sendType,
      r.account_count AS accountCount
    FROM role r
    JOIN user u ON u.type = r.role_id
    WHERE u.user_id = ? AND u.is_del = 0
    LIMIT 1
  `).bind(userId)

  const permStatement = c.env.db.prepare(`
    SELECT p.perm_key AS permKey
    FROM perm p
    JOIN role_perm rp ON rp.perm_id = p.perm_id
    JOIN user u ON u.type = rp.role_id
    WHERE u.user_id = ? AND u.is_del = 0 AND p.type = ?
  `).bind(userId, permConst.type.BUTTON)

  const [userResult, accountResult, roleResult, permResult] = await c.env.db.batch([
    userStatement,
    accountStatement,
    roleStatement,
    permStatement
  ])

  return {
    userRow: firstResult(userResult),
    account: firstResult(accountResult),
    roleRow: firstResult(roleResult),
    permKeys: resultRows(permResult).map(row => row.permKey).filter(Boolean)
  }
}
