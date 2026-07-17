import { describe, expect, it, vi } from 'vitest';
import cryptoUtils from '../src/utils/crypto-utils';

describe('crypto utils', () => {
	it('hashes new passwords with versioned PBKDF2-HMAC-SHA256', async () => {
		const { salt, hash } = await cryptoUtils.hashPassword('correct horse battery staple');

		expect(salt).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
		expect(hash).toMatch(/^pbkdf2-sha256\$v1\$\d+\$[A-Za-z0-9+/]+={0,2}$/);
		expect(await cryptoUtils.verifyPassword('correct horse battery staple', salt, hash)).toBe(true);
		expect(await cryptoUtils.verifyPassword('wrong password', salt, hash)).toBe(false);
		expect(cryptoUtils.needsPasswordUpgrade(hash)).toBe(false);
	});

	it('keeps legacy SHA-256 passwords verifiable and marks them for upgrade', async () => {
		const salt = 'legacy-salt';
		const hash = await cryptoUtils.genHashPassword('legacy-password', salt);

		expect(await cryptoUtils.verifyPassword('legacy-password', salt, hash)).toBe(true);
		expect(await cryptoUtils.verifyPassword('wrong-password', salt, hash)).toBe(false);
		expect(cryptoUtils.needsPasswordUpgrade(hash)).toBe(true);
	});

	it('rejects oversized password input before running PBKDF2', async () => {
		const { salt, hash } = await cryptoUtils.hashPassword('normal-password');
		const deriveSpy = vi.spyOn(cryptoUtils, 'derivePbkdf2');

		try {
			await expect(cryptoUtils.hashPassword('x'.repeat(1025)))
				.rejects.toThrow('Password input is too long');
			expect(await cryptoUtils.verifyPassword('x'.repeat(1025), salt, hash)).toBe(false);
			expect(deriveSpy).not.toHaveBeenCalled();
		} finally {
			deriveSpy.mockRestore();
		}
	});

	it('generates random passwords with the expected length and character set', () => {
		const password = cryptoUtils.genRandomPwd();
		const longerPassword = cryptoUtils.genRandomPwd(16);

		expect(password).toHaveLength(8);
		expect(longerPassword).toHaveLength(16);
		expect(password).toMatch(/^[A-Za-z0-9]+$/);
		expect(longerPassword).toMatch(/^[A-Za-z0-9]+$/);
	});

	it('does not depend on Math.random for generated passwords', () => {
		const randomSpy = vi.spyOn(Math, 'random').mockImplementation(() => {
			throw new Error('Math.random should not be used');
		});

		try {
			expect(cryptoUtils.genRandomPwd()).toMatch(/^[A-Za-z0-9]{8}$/);
		} finally {
			randomSpy.mockRestore();
		}
	});
});
