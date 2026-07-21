import http from '@/axios/index.js';

export function loginUserInfo() {
    return http.get('/my/loginUserInfo')
}

export function resetPassword(params) {
    return http.put('/my/resetPassword', params)
}

export function userDelete() {
    return http.delete('/my/delete')
}

