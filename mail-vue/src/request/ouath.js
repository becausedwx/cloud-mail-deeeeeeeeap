import http from '@/axios/index.js';

export function oauthLinuxDoAuthorize() {
    return http.post('/oauth/linuxDo/authorize')
}

export function oauthLinuxDoLogin(code, state) {
    return http.post('/oauth/linuxDo/login', {code, state})
}

export function oauthBindUser(form) {
    return http.put('/oauth/bindUser', form)
}
