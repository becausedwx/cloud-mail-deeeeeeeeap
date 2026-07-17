const encoder = new TextEncoder();

const secretUtils = {
	async timingSafeEqual(a, b) {
		const leftText = typeof a === 'string' ? a : '';
		const rightText = typeof b === 'string' ? b : '';
		const configured = leftText.trim().length > 0 && rightText.trim().length > 0;
		const left = encoder.encode(leftText);
		const right = encoder.encode(rightText);
		const [leftHash, rightHash] = await Promise.all([
			crypto.subtle.digest('SHA-256', left),
			crypto.subtle.digest('SHA-256', right)
		]);

		return configured && this.timingSafeBytesEqual(
			new Uint8Array(leftHash),
			new Uint8Array(rightHash)
		);
	},

	timingSafeBytesEqual(left, right) {
		if (left.length !== right.length) {
			return false;
		}

		let diff = 0;
		for (let i = 0; i < left.length; i++) {
			diff |= left[i] ^ right[i];
		}

		return diff === 0;
	}
};

export default secretUtils;
