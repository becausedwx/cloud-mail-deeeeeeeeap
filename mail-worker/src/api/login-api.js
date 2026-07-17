import app from '../hono/hono';
import loginService from '../service/login-service';
import result from '../model/result';
import userContext from '../security/user-context';
import { readBoundedJson } from '../utils/request-body-utils';

const AUTH_JSON_MAX_BYTES = 32 * 1024;

function readAuthJson(c) {
	return readBoundedJson(c, AUTH_JSON_MAX_BYTES, 'authentication JSON body exceeds 32 KiB');
}

app.post('/login', async (c) => {
	const token = await loginService.login(c, await readAuthJson(c));
	return c.json(result.ok({ token: token }));
});

app.post('/register', async (c) => {
	const jwt = await loginService.register(c, await readAuthJson(c));
	return c.json(result.ok(jwt));
});

app.delete('/logout', async (c) => {
	await loginService.logout(c, userContext.getUserId(c));
	return c.json(result.ok());
});

