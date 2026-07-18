import { describe, expect, it } from 'vitest';
import { isConfiguredDomain, parseConfiguredDomains } from '../src/utils/domain-utils';

describe('configured domain parsing', () => {
	it('normalizes array and JSON-array inputs while matching domains exactly', () => {
		expect(parseConfiguredDomains([' Example.COM ', '@Mail.Example'])).toEqual([
			'example.com',
			'mail.example'
		]);
		expect(parseConfiguredDomains('[" Example.COM ","MAIL.EXAMPLE"]')).toEqual([
			'example.com',
			'mail.example'
		]);
		expect(isConfiguredDomain('["example.com"]', 'EXAMPLE.COM')).toBe(true);
		expect(isConfiguredDomain('["example.com"]', 'notexample.com')).toBe(false);
	});
});
