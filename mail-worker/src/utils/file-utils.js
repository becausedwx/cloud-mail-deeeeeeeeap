const fileUtils = {
	getExtFileName(filename) {
		try {
			const index = filename.lastIndexOf('.');
			return index !== -1 ? filename.slice(index) : '';
		} catch (e) {
			return ''
		}
	},

	async getBuffHash(buff) {
		const hashBuffer = await crypto.subtle.digest('SHA-256', buff);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		return hashArray.slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('');
	},

	base64ToDataStr(base64) {
		return base64.split(',')[1] || base64;
	},

	base64ToUint8Array(base64) {
		let normalized = base64;
		if (normalized.includes(' ')
			|| normalized.includes('\t')
			|| normalized.includes('\n')
			|| normalized.includes('\r')
			|| normalized.includes('\f')) {
			normalized = normalized.replace(/[\t\n\f\r ]/g, '');
		}

		const padding = normalized.endsWith('==') ? 2 : normalized.endsWith('=') ? 1 : 0;
		const bytes = new Uint8Array(normalized.length / 4 * 3 - padding);
		const chunkSize = 32 * 1024;
		let byteOffset = 0;

		for (let start = 0; start < normalized.length; start += chunkSize) {
			const binary = atob(normalized.slice(start, start + chunkSize));
			for (let index = 0; index < binary.length; index++) {
				bytes[byteOffset++] = binary.charCodeAt(index);
			}
		}

		return bytes;
	},

	/**
	 * 将 Base64 数据转换为 File 对象（自动识别 MIME 类型和文件扩展名）
	 * @param {string} base64Data 带有 data: 前缀的 base64 数据
	 * @param {string} [customFilename] 可选，传入自定义文件名（不含扩展名）
	 * @returns {File} File 对象
	 */
	base64ToFile(base64Data, customFilename) {
		const match = base64Data.match(/^data:(image|jpeg|video)\/([a-zA-Z0-9.+-]+);base64,/);
		if (!match) {
			throw new Error('Invalid base64 data format');
		}

		const type = match[1]; // image 或 video
		const ext = match[2];  // jpg, png, mp4 等
		const mimeType = `${type}/${ext}`;
		const cleanBase64 = base64Data.replace(/^data:(image|jpeg|video)\/[a-zA-Z0-9.+-]+;base64,/, '');

		const byteCharacters = atob(cleanBase64);
		const byteArrays = [];

		for (let offset = 0; offset < byteCharacters.length; offset += 1024) {
			const slice = byteCharacters.slice(offset, offset + 1024);
			const byteNumbers = new Array(slice.length);
			for (let i = 0; i < slice.length; i++) {
				byteNumbers[i] = slice.charCodeAt(i);
			}
			byteArrays.push(new Uint8Array(byteNumbers));
		}

		const blob = new Blob(byteArrays, { type: mimeType });

		const filename = `${customFilename || `${type}_${Date.now()}`}.${ext}`;
		return new File([blob], filename, { type: mimeType });
	}
};


export default fileUtils;

