// 邮件正文与公告的基础 HTML 清洗。
// 黑名单覆盖脚本执行面与 mXSS 载体（svg/math/template/noscript 的 foreign-content 边界），
// 这些标签整树移除；真正的脚本执行拦截仍由 CSP（script-src 'self' + script-src-attr 'none'）兜底。
const BLOCKED_TAGS = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base', 'form',
  'svg', 'math', 'template', 'noscript', 'frame', 'frameset', 'applet'
]);
const URL_ATTRS = new Set([
  'href', 'src', 'xlink:href', 'formaction', 'action',
  'poster', 'background', 'ping', 'lowsrc', 'dynsrc'
]);
// srcset 语法特殊：逗号分隔的多个候选，每段首 token 是 URL
const SRCSET_ATTRS = new Set(['srcset', 'imagesrcset']);

export function sanitizeHtml(html = '') {
  const template = document.createElement('template');
  template.innerHTML = String(html);

  sanitizeNode(template.content);

  return template.innerHTML;
}

export function sanitizeStyleAttribute(style = '') {
  return String(style)
      .split(';')
      .map(item => item.trim())
      .filter(Boolean)
      .filter(item => !/<\/?style/i.test(item))
      .filter(item => !/@import/i.test(item))
      .filter(item => !/expression\s*\(/i.test(item))
      .filter(item => !/url\s*\(/i.test(item))
      .filter(item => !/image-set\s*\(/i.test(item))
      .filter(item => !/-moz-binding/i.test(item))
      .filter(item => !/behavior\s*:/i.test(item))
      .join('; ');
}

function sanitizeNode(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT);
  const nodes = [];

  while (walker.nextNode()) {
    nodes.push(walker.currentNode);
  }

  nodes.forEach((node) => {
    // 注释节点（含 IE 条件注释）不参与展示，直接移除以缩小再解析歧义面
    if (node.nodeType === Node.COMMENT_NODE) {
      node.remove();
      return;
    }

    const tagName = node.tagName?.toLowerCase();

    if (BLOCKED_TAGS.has(tagName)) {
      node.remove();
      return;
    }

    Array.from(node.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();

      if (name.startsWith('on') || name === 'srcdoc') {
        node.removeAttribute(attr.name);
        return;
      }

      if (URL_ATTRS.has(name) && isUnsafeUrl(value)) {
        node.removeAttribute(attr.name);
        return;
      }

      if (SRCSET_ATTRS.has(name) && isUnsafeSrcset(value)) {
        node.removeAttribute(attr.name);
        return;
      }

      if (name === 'style') {
        const safeStyle = sanitizeStyleAttribute(value);
        if (safeStyle) {
          node.setAttribute(attr.name, safeStyle);
        } else {
          node.removeAttribute(attr.name);
        }
      }
    });
  });
}

function isUnsafeUrl(value) {
  const normalized = value.replace(/[\u0000-\u001F\u007F\s]+/g, '').toLowerCase();
  if (normalized.startsWith('javascript:') || normalized.startsWith('vbscript:')) {
    return true;
  }
  if (!normalized.startsWith('data:')) {
    return false;
  }
  // data: 仅放行位图类图片；data:image/svg+xml 可携带脚本，一律拒绝
  return !normalized.startsWith('data:image/') || normalized.startsWith('data:image/svg');
}

function isUnsafeSrcset(value) {
  return String(value)
      .split(',')
      .map(candidate => candidate.trim().split(/\s+/)[0] || '')
      .some(url => isUnsafeUrl(url));
}
