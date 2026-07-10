import { setBrowserSafeHeader } from '../utils/http-header-utils';

const kvObjService = {

	async putObj(c, key, content, metadata) {
		await c.env.kv.put(key, content, { metadata: metadata });
	},

	async deleteObj(c, keys) {

		if (typeof keys === 'string') {
			keys = [keys];
		}

		if (keys.length === 0) {
			return;
		}

		await Promise.all(keys.map( key => c.env.kv.delete(key)));
	},

	async getObj(c, key) {
		const obj = await c.env.kv.getWithMetadata(key, { type: 'stream' });
		if (!obj.value) {
			return null;
		}

		const headers = new Headers({ 'Content-Type': 'application/octet-stream' });
		setBrowserSafeHeader(headers, 'Content-Type', obj.metadata?.contentType);
		setBrowserSafeHeader(headers, 'Content-Disposition', obj.metadata?.contentDisposition);
		setBrowserSafeHeader(headers, 'Cache-Control', obj.metadata?.cacheControl);

		return new Response(obj.value, { headers });
	},

	async toObjResp(c, key) {

		return await this.getObj(c, key) || new Response('Not found', { status: 404 });

	}

};

export default kvObjService;
