import app from '../hono/hono';
import { dbInit } from '../init/init';
import { getBootstrapStatus } from '../init/status';
import result from '../model/result';

app.get('/init/status', async (c) => {
	return c.json(result.ok(await getBootstrapStatus(c)));
});

app.post('/init', (c) => {
	return dbInit.init(c);
})
