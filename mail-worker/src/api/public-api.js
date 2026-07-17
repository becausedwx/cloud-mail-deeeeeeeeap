import app from '../hono/hono';
import result from '../model/result';
import publicService from '../service/public-service';
import { readBoundedSendJson } from '../utils/send-request-utils';

app.post('/public/genToken', async (c) => {
	const data = await publicService.genToken(c, await c.req.json());
	return c.json(result.ok(data));
});

app.post('/public/emailList', async (c) => {
	const list = await publicService.emailList(c, await c.req.json());
	return c.json(result.ok(list));
});

app.post('/public/addUser', async (c) => {
	await publicService.addUser(c, await c.req.json());
	return c.json(result.ok());
});

app.post('/public/sendEmail', async (c) => {
	const data = await publicService.sendEmail(
		c,
		await readBoundedSendJson(c, 'public send JSON body exceeds 24 MiB')
	);
	return c.json(result.ok(data));
});
