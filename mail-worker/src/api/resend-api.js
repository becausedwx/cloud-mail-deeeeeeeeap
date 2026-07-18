import resendService from '../service/resend-service';
import app from '../hono/hono';
import { readBoundedText } from '../utils/request-body-utils';

const RESEND_WEBHOOK_MAX_BYTES = 256 * 1024;

app.post('/webhooks',async (c) => {
	const rawBody = await readBoundedText(
		c,
		RESEND_WEBHOOK_MAX_BYTES,
		'Resend webhook body exceeds 256 KiB',
		'invalid webhook body'
	);
	await resendService.webhooks(c, rawBody);
	return c.text('success', 200)
})
