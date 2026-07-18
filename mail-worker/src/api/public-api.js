import app from '../hono/hono';
import result from '../model/result';
import publicService from '../service/public-service';
import { readBoundedSendJson } from '../utils/send-request-utils';
import { readBoundedJson } from '../utils/request-body-utils';

const AUTH_JSON_MAX_BYTES = 32 * 1024;
const PUBLIC_QUERY_JSON_MAX_BYTES = 64 * 1024;
const PUBLIC_IMPORT_JSON_MAX_BYTES = 512 * 1024;

app.post('/public/genToken', async (c) => {
	const data = await publicService.genToken(c, await readBoundedJson(
		c,
		AUTH_JSON_MAX_BYTES,
		'authentication JSON body exceeds 32 KiB'
	));
	return c.json(result.ok(data));
});

app.post('/public/emailList', async (c) => {
	const list = await publicService.emailList(c, await readBoundedJson(
		c,
		PUBLIC_QUERY_JSON_MAX_BYTES,
		'public query JSON body exceeds 64 KiB'
	));
	return c.json(result.ok(list));
});

app.post('/public/addUser', async (c) => {
	await publicService.addUser(c, await readBoundedJson(
		c,
		PUBLIC_IMPORT_JSON_MAX_BYTES,
		'public import JSON body exceeds 512 KiB'
	));
	return c.json(result.ok());
});

app.post('/public/sendEmail', async (c) => {
	const data = await publicService.sendEmail(
		c,
		await readBoundedSendJson(c, 'public send JSON body exceeds 24 MiB')
	);
	return c.json(result.ok(data));
});
