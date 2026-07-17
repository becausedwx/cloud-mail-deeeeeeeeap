const encoder = new TextEncoder();
const PBKDF2_PREFIX = 'pbkdf2-sha256';
const PBKDF2_VERSION = 'v1';
const PBKDF2_HASH_BYTES = 32;
const PASSWORD_HASH_INPUT_MAX_LENGTH = 1024;

export const PBKDF2_ITERATIONS = 100000;

function bytesToBase64(bytes) {
	return btoa(String.fromCharCode(...bytes));
}

function base64ToBytes(value) {
	return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}

function constantTimeEqual(left, right) {
	if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array)) {
		return false;
	}

	let difference = left.length ^ right.length;
	const length = Math.max(left.length, right.length);
	for (let index = 0; index < length; index++) {
		difference |= (left[index % left.length] || 0) ^ (right[index % right.length] || 0);
	}
	return difference === 0;
}

function parsePbkdf2Hash(storedHash) {
	if (typeof storedHash !== 'string') {
		return null;
	}

	const [prefix, version, iterationsValue, encodedHash, extra] = storedHash.split('$');
	const iterations = Number(iterationsValue);
	if (extra !== undefined
		|| prefix !== PBKDF2_PREFIX
		|| version !== PBKDF2_VERSION
		|| !Number.isInteger(iterations)
		|| iterations <= 0
		|| !encodedHash) {
		return null;
	}

	return { iterations, encodedHash };
}

const saltHashUtils = {

	generateSalt(length = 16) {
		const array = new Uint8Array(length);
		crypto.getRandomValues(array);
		return bytesToBase64(array);
	},

	async hashPassword(password) {
		if (typeof password !== 'string') {
			throw new TypeError('Password must be a string');
		}
		if (password.length > PASSWORD_HASH_INPUT_MAX_LENGTH) {
			throw new RangeError('Password input is too long');
		}

		const salt = this.generateSalt();
		const derived = await this.derivePbkdf2(password, salt, PBKDF2_ITERATIONS);
		return {
			salt,
			hash: `${PBKDF2_PREFIX}$${PBKDF2_VERSION}$${PBKDF2_ITERATIONS}$${bytesToBase64(derived)}`
		};
	},

	async derivePbkdf2(password, salt, iterations) {
		const key = await crypto.subtle.importKey(
			'raw',
			encoder.encode(password),
			'PBKDF2',
			false,
			['deriveBits']
		);
		const bits = await crypto.subtle.deriveBits({
			name: 'PBKDF2',
			hash: 'SHA-256',
			salt: base64ToBytes(salt),
			iterations
		}, key, PBKDF2_HASH_BYTES * 8);
		return new Uint8Array(bits);
	},

	async genHashPassword(password, salt) {
		const data = encoder.encode(salt + password);
		const hashBuffer = await crypto.subtle.digest('SHA-256', data);
		return bytesToBase64(new Uint8Array(hashBuffer));
	},

	async verifyPassword(inputPassword, salt, storedHash) {
		if (typeof inputPassword !== 'string'
			|| typeof salt !== 'string'
			|| typeof storedHash !== 'string'
			|| inputPassword.length > PASSWORD_HASH_INPUT_MAX_LENGTH) {
			return false;
		}

		const parsed = parsePbkdf2Hash(storedHash);
		if (storedHash.startsWith(`${PBKDF2_PREFIX}$`)) {
			if (!parsed) return false;
			try {
				const actual = await this.derivePbkdf2(inputPassword, salt, parsed.iterations);
				return constantTimeEqual(actual, base64ToBytes(parsed.encodedHash));
			} catch (e) {
				return false;
			}
		}

		try {
			const actual = base64ToBytes(await this.genHashPassword(inputPassword, salt));
			return constantTimeEqual(actual, base64ToBytes(storedHash));
		} catch (e) {
			return false;
		}
	},

	needsPasswordUpgrade(storedHash) {
		const parsed = parsePbkdf2Hash(storedHash);
		return !parsed || parsed.iterations < PBKDF2_ITERATIONS;
	},

	genRandomPwd(length = 8) {
		const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
		let result = '';
		const maxUnbiasedByte = Math.floor(256 / chars.length) * chars.length;

		while (result.length < length) {
			const bytes = new Uint8Array(Math.max(length - result.length, 1));
			crypto.getRandomValues(bytes);
			for (const byte of bytes) {
				if (byte >= maxUnbiasedByte) {
					continue;
				}
				result += chars.charAt(byte % chars.length);
				if (result.length === length) {
					break;
				}
			}
		}
		return result;
	}
};

export default saltHashUtils;
