import app from '../hono/hono';
import result from "../model/result";
import oauthService from "../service/oauth-service";
import { readBoundedJson } from '../utils/request-body-utils';

const OAUTH_JSON_MAX_BYTES = 32 * 1024;

app.post('/oauth/linuxDo/authorize', async (c) => {
	const authorization = await oauthService.createLinuxDoAuthorization(c);
	return c.json(result.ok(authorization));
});

app.post('/oauth/linuxDo/login', async (c) => {
	const loginInfo = await oauthService.linuxDoLogin(c, await readBoundedJson(
		c,
		OAUTH_JSON_MAX_BYTES,
		'OAuth JSON body exceeds 32 KiB'
	));
	return c.json(result.ok(loginInfo))
});

app.put('/oauth/bindUser', async (c) => {
	const loginInfo = await oauthService.bindUser(c, await readBoundedJson(
		c,
		OAUTH_JSON_MAX_BYTES,
		'OAuth JSON body exceeds 32 KiB'
	));
	return c.json(result.ok(loginInfo))
})
