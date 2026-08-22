import KvConst from '../const/kv-const';
import constant from '../const/constant';

// authInfo 短 TTL 隔离内缓存：
// 认证中间件每个请求都要读一次 KV（轮询接口尤甚），这里用短窗口合并突发读。
// KV 本身是最终一致存储，撤销/登出延迟多几秒在既有语义之内；
// 写入方在 kv.put 后调用 refresh、删除处调用 remove，同 isolate 内立即生效。
const AUTH_CACHE_TTL = 8 * 1000;
const authCache = new Map();

function getCache(key) {
	const item = authCache.get(key);
	if (!item || item.expiresAt <= Date.now()) {
		authCache.delete(key);
		return null;
	}
	return item.value;
}

function setCache(key, value) {
	authCache.set(key, {
		value,
		expiresAt: Date.now() + AUTH_CACHE_TTL
	});
	return value;
}

const authInfoCache = {

	async get(c, userId) {
		const key = KvConst.AUTH_INFO + userId;
		const cached = getCache(key);
		if (cached) {
			return cached;
		}
		const authInfo = await c.env.kv.get(key, { type: 'json' });
		if (authInfo) {
			setCache(key, authInfo);
		}
		return authInfo;
	},

	// 写 KV 后刷新本地缓存（不改变原 TTL 语义）
	async refresh(c, userId, authInfo) {
		setCache(KvConst.AUTH_INFO + userId, authInfo);
		await c.env.kv.put(KvConst.AUTH_INFO + userId, JSON.stringify(authInfo), { expirationTtl: constant.TOKEN_EXPIRE });
	},

	async remove(c, userId) {
		const key = KvConst.AUTH_INFO + userId;
		authCache.delete(key);
		await c.env.kv.delete(key);
	}
};

export default authInfoCache;
