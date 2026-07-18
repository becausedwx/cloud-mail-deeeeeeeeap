import http from "@/axios/index.js";

export function starAdd(emailId) {
    return http.post('/star/add', {emailId})
}

export function starCancel(emailId) {
    return http.delete('/star/cancel', {params: {emailId}})
}

export function starList(emailId,size,_withTotal, {signal} = {}) {
    return http.get('/star/list', {params: {emailId,size,lite: 1}, signal})
}
