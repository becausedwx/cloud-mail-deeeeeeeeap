import app from './hono/webs';
import { email } from './email/email';
import userService from './service/user-service';
import verifyRecordService from './service/verify-record-service';
import emailService from './service/email-service';
import oauthService from "./service/oauth-service";
import analysisService from './service/analysis-service';
import attService from './service/att-service';
import r2Service from './service/r2-service';
import maintenanceService from './service/maintenance-service';
import authRateLimitService from './service/auth-rate-limit-service';
import deliveryAttemptService from './service/delivery-attempt-service';

async function objectResponse(c, key) {
	const obj = await r2Service.getObj(c, key);
	return r2Service.toResponse(obj) || new Response('Not found', { status: 404 });
}

async function runScheduledTask(name, task) {
	try {
		await task();
	} catch (e) {
		console.error(`Scheduled task ${name} failed:`, e?.message || e);
	}
}

function isEnabled(value) {
	return value === true || value === 1 || value === 'true' || value === '1';
}

export default {
	 async fetch(req, env, ctx) {

		const url = new URL(req.url)

		if (url.pathname.startsWith('/api/')) {
			url.pathname = url.pathname.replace('/api', '')
			req = new Request(url.toString(), req)
			return app.fetch(req, env, ctx);
		}

		 if (url.pathname.startsWith('/attachments/')) {
			 const key = url.pathname.substring(1);
			 if (!await attService.isPublicInlineKey({ env }, key)) {
				 return new Response('Not found', { status: 404 });
			 }
			 return await objectResponse({ env }, key);
		 }

		 if (url.pathname.startsWith('/static/')) {
			 return await objectResponse({ env }, url.pathname.substring(1));
		 }

		return env.assets.fetch(req);
	},
	email: email,
	async scheduled(c, env, ctx) {
		if (c.cron === '*/30 * * * *') {
			await runScheduledTask('complete-receive-all', () => emailService.completeReceiveAll({ env }))
			await runScheduledTask('delivery-attempt-reconcile', () => deliveryAttemptService.reconcile({ env }))
			await runScheduledTask('clear-expired-auth-failures', () => authRateLimitService.clearExpired({ env }))
			await runScheduledTask('clear-expired-oauth-security', () => oauthService.clearExpiredOAuthSecurity({ env }))
			await runScheduledTask('analysis-cache', () => analysisService.refreshEchartsCache({ env }))
			return;
		}

		await runScheduledTask('verify-record-clear', () => verifyRecordService.clearRecord({ env }))
		await runScheduledTask('reset-day-send-count', () => userService.resetDaySendCount({ env }))
		await runScheduledTask('complete-receive-all', () => emailService.completeReceiveAll({ env }))
		await runScheduledTask('delivery-attempt-reconcile', () => deliveryAttemptService.reconcile({ env }))
		await runScheduledTask('clear-unbound-oauth-users', () => oauthService.clearNoBindOathUser({ env }))
		await runScheduledTask('clear-expired-auth-failures', () => authRateLimitService.clearExpired({ env }))
		if (isEnabled(env.code_clear_stale_cron)) {
			await runScheduledTask('codes-clear-stale', () => maintenanceService.clearStaleCodes({ env }, {
				staleMinutes: env.code_stale_minutes
			}))
		}
		await runScheduledTask('analysis-cache', () => analysisService.refreshEchartsCache({ env }))
	},
};
