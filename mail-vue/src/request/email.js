import http from '@/axios/index.js';

export function emailList(accountId, allReceive, emailId, timeSort, size, type, withTotal = 1, {signal} = {}) {
    return http.get('/email/list', {params: {accountId, allReceive, emailId, timeSort, size, type, lite: 1, withTotal}, signal})
}

export function emailDelete(emailIds) {
    return http.delete('/email/delete?emailIds=' + emailIds)
}

export function emailLatest(emailId, accountId, allReceive, {signal} = {}) {
    return http.get('/email/latest', {params: {emailId, accountId, allReceive, lite: 1}, noMsg: true, timeout: 35 * 1000, signal})
}

export function emailDetail(emailId, {signal} = {}) {
    return http.get('/email/detail', {params: {emailId}, signal})
}

export function emailRead(emailIds) {
    return http.put('/email/read', {emailIds})
}

export function emailSend(form,progress) {
    return http.post('/email/send', form,{
        onUploadProgress: (e) => {
            progress(e)
        },
        noMsg: true,
        // 带附件的发信耗时较长，放宽超时
        timeout: 120 * 1000
    })
}
