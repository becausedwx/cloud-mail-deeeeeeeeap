import { S3Client, PutObjectCommand, DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import settingService from './setting-service';
import domainUtils from '../utils/domain-uitls';
import { settingConst } from '../const/entity-const';
import { isBrowserSafeHeaderValue, setBrowserSafeHeader } from '../utils/http-header-utils';

function isMissingObjectError(error) {
	return error?.$metadata?.httpStatusCode === 404
		|| error?.name === 'NoSuchKey'
		|| error?.name === 'NotFound';
}

function objectHeaders(result) {
	const headers = new Headers({ 'Content-Type': 'application/octet-stream' });
	setBrowserSafeHeader(headers, 'Content-Type', result.ContentType);
	setBrowserSafeHeader(headers, 'Content-Language', result.ContentLanguage);
	setBrowserSafeHeader(headers, 'Content-Disposition', result.ContentDisposition);
	setBrowserSafeHeader(headers, 'Content-Encoding', result.ContentEncoding);
	setBrowserSafeHeader(headers, 'Cache-Control', result.CacheControl);
	if (result.Expires instanceof Date && !Number.isNaN(result.Expires.getTime())) {
		headers.set('Expires', result.Expires.toUTCString());
	}
	return headers;
}

const s3Service = {

	async putObj(c, key, content, metadata) {

		const client = await this.client(c);

		const { bucket } = await settingService.query(c);

		const obj = { Bucket: bucket, Key: key, Body: content }

		if (isBrowserSafeHeaderValue(metadata.cacheControl)) {
			obj.CacheControl = metadata.cacheControl
		}

		if (isBrowserSafeHeaderValue(metadata.contentDisposition)) {
			obj.ContentDisposition = metadata.contentDisposition
		}

		if (isBrowserSafeHeaderValue(metadata.contentType)) {
			obj.ContentType = metadata.contentType
		}

		await client.send(new PutObjectCommand(obj))
	},

	async deleteObj(c, keys) {

		if (typeof keys === 'string') {
			keys = [keys];
		}

		if (keys.length === 0) {
			return;
		}

		const client = await this.client(c);
		const { bucket } = await settingService.query(c);


		client.middlewareStack.add(
			(next) => async (args) => {

				const body = args.request.body

				// 计算 MD5 校验和并转换为 Base64 编码
				const encoder = new TextEncoder();
				const data = encoder.encode(body);

				// 使用 Web Crypto API 计算 MD5 校验和
				const hashBuffer = await crypto.subtle.digest('MD5', data);
				const hashArray = new Uint8Array(hashBuffer);
				const contentMD5 = btoa(String.fromCharCode.apply(null, hashArray));

				args.request.headers["Content-MD5"] = contentMD5;

				return next(args);
			},
			{ step: "build", name: "inspectRequestMiddleware" }
		);


		await client.send(
			new DeleteObjectsCommand({
				Bucket: bucket,
				Delete: {
					Objects: keys.map(key => ({ Key: key }))
				}
			})
		);
	},

	async getObj(c, key) {
		const client = await this.client(c);
		const { bucket } = await settingService.query(c);
		try {
			const result = await client.send(new GetObjectCommand({
				Bucket: bucket,
				Key: key
			}));

			return new Response(result.Body, { headers: objectHeaders(result) });
		} catch (e) {
			if (isMissingObjectError(e)) {
				return null;
			}
			throw e;
		}
	},

	async exists(c, key, options = {}) {
		const client = await this.client(c, options);
		const { bucket } = await settingService.query(c);
		try {
			await client.send(new HeadObjectCommand({
				Bucket: bucket,
				Key: key
			}));
			return true;
		} catch (e) {
			if (isMissingObjectError(e)) {
				return false;
			}
			throw e;
		}
	},


	async client(c, options = {}) {
		const { region, endpoint, s3AccessKey, s3SecretKey, forcePathStyle } = await settingService.query(c);
		const clientOptions = {
			region: region || 'auto',
			endpoint: domainUtils.toOssDomain(endpoint),
			forcePathStyle: forcePathStyle === settingConst.forcePathStyle.OPEN,
			credentials: {
				accessKeyId: s3AccessKey,
				secretAccessKey: s3SecretKey,
			}
		};
		if (Number.isInteger(options.maxAttempts) && options.maxAttempts > 0) {
			clientOptions.maxAttempts = options.maxAttempts;
		}
		return new S3Client(clientOptions);
	}
}

export default s3Service
