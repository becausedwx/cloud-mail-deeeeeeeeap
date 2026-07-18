import app from '../hono/hono';
import result from '../model/result';
import maintenanceService from '../service/maintenance-service';
import { readBoundedJson } from '../utils/request-body-utils';

const MAINTENANCE_JSON_MAX_BYTES = 16 * 1024;

app.get('/maintenance/health', async (c) => {
	const data = await maintenanceService.health(c);
	return c.json(result.ok(data));
});

app.post('/maintenance/repair', async (c) => {
	const { action } = await readBoundedJson(
		c,
		MAINTENANCE_JSON_MAX_BYTES,
		'maintenance JSON body exceeds 16 KiB'
	);
	const data = await maintenanceService.repair(c, action);
	return c.json(result.ok(data));
});
