import app from '../hono/hono';
import { dbInit } from '../init/init';
import { getBootstrapStatus } from '../init/status';
import result from '../model/result';

// 该端点匿名可访问：未就绪时每次请求都要跑一整批 PRAGMA 与 sqlite_master 查询，
// 缓存住这段结果才不会被反复扫描放大成 D1 开销；TTL 取短值以免拖慢初始化引导
app.get('/init/status', async (c) => {
	return c.json(result.ok(await getBootstrapStatus(c, { cachePending: true })));
});

app.post('/init', (c) => {
	return dbInit.init(c);
})

app.post('/init/admin', (c) => {
	return dbInit.createAdmin(c);
});
