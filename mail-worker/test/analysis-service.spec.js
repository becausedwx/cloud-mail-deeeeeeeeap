import { afterEach, describe, expect, it, vi } from 'vitest';
import analysisService from '../src/service/analysis-service';
import analysisDao from '../src/dao/analysis-dao';

describe('analysis service cache refresh', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('paginates KV keys, reuses one global snapshot set, and isolates key refresh failures', async () => {
		const numberCount = { users: 1, receive: 2, send: 3 };
		const nameRatio = [{ name: 'sender', total: 4 }];
		const list = vi.fn()
			.mockResolvedValueOnce({
				keys: [{ name: 'analysis_echarts:UTC' }, { name: 'analysis_echarts:Asia%2FShanghai' }],
				list_complete: false,
				cursor: 'next-page'
			})
			.mockResolvedValueOnce({
				keys: [{ name: 'analysis_echarts:Europe%2FLondon' }],
				list_complete: true
			});
		const c = {
			env: {
				analysis_cache: 'true',
				kv: { list }
			}
		};
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const refreshNumberCountCache = vi.spyOn(analysisService, 'refreshNumberCountCache')
			.mockResolvedValue(numberCount);
		const queryNameRatio = vi.spyOn(analysisService, 'nameRatio')
			.mockResolvedValue(nameRatio);
		const refreshEchartsCacheByKey = vi.spyOn(analysisService, 'refreshEchartsCacheByKey')
			.mockImplementation(async (_c, key) => {
				if (key === 'analysis_echarts:Asia%2FShanghai') {
					throw new Error('refresh failed');
				}
			});

		await analysisService.refreshEchartsCache(c);

		expect(refreshNumberCountCache).toHaveBeenCalledTimes(1);
		expect(queryNameRatio).toHaveBeenCalledTimes(1);
		expect(list).toHaveBeenNthCalledWith(1, { prefix: 'analysis_echarts:', cursor: undefined });
		expect(list).toHaveBeenNthCalledWith(2, { prefix: 'analysis_echarts:', cursor: 'next-page' });
		expect(refreshEchartsCacheByKey).toHaveBeenCalledTimes(3);
		expect(refreshEchartsCacheByKey.mock.calls.every(call => call[2].numberCount === numberCount)).toBe(true);
		expect(refreshEchartsCacheByKey.mock.calls.every(call => call[2].nameRatio === nameRatio)).toBe(true);
		expect(errorSpy).toHaveBeenCalledTimes(1);
	});

	it('uses a 35 minute TTL for on-demand and scheduled number count snapshots', async () => {
		const numberCount = { users: 1 };
		const get = vi.fn().mockResolvedValue(null);
		const put = vi.fn().mockResolvedValue(undefined);
		const c = {
			env: {
				analysis_cache: true,
				kv: { get, put }
			}
		};
		vi.spyOn(analysisDao, 'numberCount').mockResolvedValue(numberCount);

		expect(await analysisService.numberCount(c)).toBe(numberCount);
		expect(await analysisService.refreshNumberCountCache(c)).toBe(numberCount);

		expect(put).toHaveBeenCalledTimes(2);
		expect(put.mock.calls.every(call => (
			call[0] === 'analysis_number_count:'
			&& call[2]?.expirationTtl === 35 * 60
		))).toBe(true);
	});

	it('does not query or write scheduled analysis caches when caching is disabled', async () => {
		const list = vi.fn();
		const put = vi.fn();
		const c = {
			env: {
				analysis_cache: false,
				kv: { list, put }
			}
		};
		const numberCountQuery = vi.spyOn(analysisDao, 'numberCount')
			.mockResolvedValue({ users: 1 });
		const nameRatioQuery = vi.spyOn(analysisService, 'nameRatio')
			.mockResolvedValue([]);

		await analysisService.refreshEchartsCache(c);

		expect(numberCountQuery).not.toHaveBeenCalled();
		expect(nameRatioQuery).not.toHaveBeenCalled();
		expect(list).not.toHaveBeenCalled();
		expect(put).not.toHaveBeenCalled();

		await analysisService.refreshNumberCountCache(c);
		expect(numberCountQuery).toHaveBeenCalledTimes(1);
		expect(put).not.toHaveBeenCalled();
	});

	it('queries nameRatio on demand and uses a supplied refresh snapshot', async () => {
		const numberCount = { users: 1 };
		const onDemandRatio = [{ name: 'on-demand', total: 2 }];
		const suppliedRatio = [{ name: 'scheduled', total: 3 }];
		const c = {
			env: {
				kv: { get: vi.fn().mockResolvedValue(0) }
			}
		};
		vi.spyOn(analysisService, 'numberCount').mockResolvedValue(numberCount);
		const nameRatioQuery = vi.spyOn(analysisService, 'nameRatio')
			.mockResolvedValue(onDemandRatio);
		vi.spyOn(analysisDao, 'userDayCount').mockResolvedValue([]);
		vi.spyOn(analysisDao, 'receiveDayCount').mockResolvedValue([]);
		vi.spyOn(analysisDao, 'sendDayCount').mockResolvedValue([]);

		const onDemand = await analysisService.queryEcharts(c, { timeZone: 'UTC' });
		expect(nameRatioQuery).toHaveBeenCalledTimes(1);
		expect(onDemand.receiveRatio.nameRatio).toBe(onDemandRatio);

		nameRatioQuery.mockClear();
		const scheduled = await analysisService.queryEcharts(c, { timeZone: 'UTC' }, {
			numberCount,
			nameRatio: suppliedRatio
		});
		expect(nameRatioQuery).not.toHaveBeenCalled();
		expect(scheduled.receiveRatio.nameRatio).toBe(suppliedRatio);
	});
});
