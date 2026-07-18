import app from '../hono/hono';
import result from '../model/result';
import settingService from '../service/setting-service';
import userContext from "../security/user-context";
import { readBoundedJson } from '../utils/request-body-utils';

const SETTING_JSON_MAX_BYTES = 1024 * 1024;
const BACKGROUND_JSON_MAX_BYTES = 16 * 1024 * 1024;

function readSettingJson(c) {
	return readBoundedJson(c, SETTING_JSON_MAX_BYTES, 'setting JSON body exceeds 1 MiB');
}

app.put('/setting/set', async (c) => {
	await settingService.set(c, await readSettingJson(c));
	return c.json(result.ok());
});

app.get('/setting/query', async (c) => {
	const setting = await settingService.get(c);
	return c.json(result.ok(setting));
});

app.get('/setting/websiteConfig', async (c) => {
	const setting = await settingService.websiteConfig(c);
	return c.json(result.ok(setting));
})

app.put('/setting/setBackground', async (c) => {
	const key = await settingService.setBackground(c, await readBoundedJson(
		c,
		BACKGROUND_JSON_MAX_BYTES,
		'background JSON body exceeds 16 MiB'
	));
	return c.json(result.ok(key));
});

app.delete('/setting/deleteBackground', async (c) => {
	await settingService.deleteBackground(c);
	return c.json(result.ok());
});

app.put('/setting/setBlacklist', async (c) => {
	const setting = await settingService.setBlacklist(c, await readSettingJson(c));
	return c.json(result.ok(setting));
})

