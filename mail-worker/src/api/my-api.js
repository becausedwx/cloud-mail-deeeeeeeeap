import app from '../hono/hono';
import userService from '../service/user-service';
import result from '../model/result';
import userContext from '../security/user-context';
import { readBoundedJson } from '../utils/request-body-utils';

const PROFILE_JSON_MAX_BYTES = 32 * 1024;

app.get('/my/loginUserInfo', async (c) => {
	const user = await userService.loginUserInfo(c, userContext.getUserId(c));
	return c.json(result.ok(user));
});

app.put('/my/resetPassword', async (c) => {
	await userService.resetPassword(c, await readBoundedJson(
		c,
		PROFILE_JSON_MAX_BYTES,
		'profile JSON body exceeds 32 KiB'
	), userContext.getUserId(c));
	return c.json(result.ok());
});

app.delete('/my/delete', async (c) => {
	await userService.delete(c, userContext.getUserId(c));
	return c.json(result.ok());
});


