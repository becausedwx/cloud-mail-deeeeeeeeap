import s3Service from './s3-service';
import settingService from './setting-service';
import kvObjService from './kv-obj-service';
import { isBrowserSafeHeaderValue, setBrowserSafeHeader } from '../utils/http-header-utils';

function sanitizeHttpMetadata(metadata = {}) {
	const result = {};
	for (const key of [
		'contentType',
		'contentLanguage',
		'contentDisposition',
		'contentEncoding',
		'cacheControl'
	]) {
		if (isBrowserSafeHeaderValue(metadata[key])) {
			result[key] = metadata[key];
		}
	}

	if (metadata.cacheExpiry instanceof Date && !Number.isNaN(metadata.cacheExpiry.getTime())) {
		result.cacheExpiry = metadata.cacheExpiry;
	}

	return result;
}

function copyHttpMetadata(headers, metadata = {}) {
	setBrowserSafeHeader(headers, 'Content-Type', metadata.contentType);
	setBrowserSafeHeader(headers, 'Content-Language', metadata.contentLanguage);
	setBrowserSafeHeader(headers, 'Content-Disposition', metadata.contentDisposition);
	setBrowserSafeHeader(headers, 'Content-Encoding', metadata.contentEncoding);
	setBrowserSafeHeader(headers, 'Cache-Control', metadata.cacheControl);

	if (metadata.cacheExpiry instanceof Date && !Number.isNaN(metadata.cacheExpiry.getTime())) {
		headers.set('Expires', metadata.cacheExpiry.toUTCString());
	}
}

const r2Service = {

	async storageType(c) {

		const setting = await settingService.query(c);
		const { bucket, endpoint, s3AccessKey, s3SecretKey } = setting;

		if (!!(bucket && endpoint && s3AccessKey && s3SecretKey)) {
			return 'S3';
		}

		if (c.env.r2) {
			return 'R2';
		}

		return 'KV';
	},

	async putObj(c, key, content, metadata) {

		const storageType = await this.storageType(c);
		const safeMetadata = sanitizeHttpMetadata(metadata);

		if (storageType === 'KV') {
			await kvObjService.putObj(c, key, content, safeMetadata);
		}

		if (storageType === 'R2') {
			await c.env.r2.put(key, content, {
				httpMetadata: safeMetadata
			});
		}

		if (storageType === 'S3') {
			await s3Service.putObj(c, key, content, safeMetadata);
		}

	},

	async getObj(c, key) {
		const storageType = await this.storageType(c);

		if (storageType === 'KV') {
			return await kvObjService.getObj(c, key);
		}

		if (storageType === 'R2') {
			return await c.env.r2.get(key);
		}

		if (storageType === 'S3') {
			return await s3Service.getObj(c, key);
		}
	},

	toResponse(obj, extraHeaders = {}) {
		if (!obj) {
			return null;
		}

		const headers = new Headers();
		let body = obj.body;

		if (obj instanceof Response) {
			body = obj.body;
			obj.headers.forEach((value, key) => {
				if (value !== 'null') {
					setBrowserSafeHeader(headers, key, value);
				}
			});
		} else if (obj.httpMetadata) {
			copyHttpMetadata(headers, obj.httpMetadata);
		} else if (typeof obj.writeHttpMetadata === 'function') {
			const metadataHeaders = new Headers();
			try {
				obj.writeHttpMetadata(metadataHeaders);
				metadataHeaders.forEach((value, key) => setBrowserSafeHeader(headers, key, value));
			} catch (e) {
				if (e?.name !== 'TypeError') {
					throw e;
				}
				// Invalid legacy metadata must not make the object body unavailable.
			}
		}

		if (!headers.get('Content-Type')) {
			headers.set('Content-Type', 'application/octet-stream');
		}

		Object.entries(extraHeaders).forEach(([key, value]) => {
			setBrowserSafeHeader(headers, key, value);
		});

		return new Response(body, { headers });
	},

	async delete(c, key) {

		const storageType = await this.storageType(c);

		if (storageType === 'KV') {
			await kvObjService.deleteObj(c, key);
		}

		if (storageType === 'R2') {
			await c.env.r2.delete(key);
		}

		if (storageType === 'S3'){
			await s3Service.deleteObj(c, key);
		}

	}

};
export default r2Service;
