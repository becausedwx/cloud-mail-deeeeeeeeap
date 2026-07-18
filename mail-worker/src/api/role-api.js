import app from '../hono/hono';
import roleService from '../service/role-service';
import userContext from '../security/user-context';
import result from '../model/result';
import permService from '../service/perm-service';
import { readBoundedJson } from '../utils/request-body-utils';

const ROLE_JSON_MAX_BYTES = 256 * 1024;

function readRoleJson(c) {
	return readBoundedJson(c, ROLE_JSON_MAX_BYTES, 'role JSON body exceeds 256 KiB');
}

app.post('/role/add', async (c) => {
	await roleService.add(c, await readRoleJson(c), userContext.getUserId(c));
	return c.json(result.ok());
});

app.put('/role/setDefault', async (c) => {
	await roleService.setDefault(c, await readRoleJson(c));
	return c.json(result.ok());
});

app.put('/role/set', async (c) => {
	await roleService.setRole(c, await readRoleJson(c));
	return c.json(result.ok());
});

app.get('/role/tree', async (c) => {
	const tree = await permService.tree(c);
	return c.json(result.ok(tree));
});

app.delete('/role/delete', async (c) => {
	await roleService.delete(c, c.req.query());
	return c.json(result.ok());
});

app.get('/role/list', async (c) => {
	const roleList = await roleService.roleList(c);
	return c.json(result.ok(roleList));
});

app.get('/role/selectUse', async (c) => {
	const roleList = await roleService.roleSelectUse(c);
	return c.json(result.ok(roleList));
});



