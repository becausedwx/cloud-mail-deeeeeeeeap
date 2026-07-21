import { parseHTML } from 'linkedom';
import domainUtils from '../utils/domain-uitls';
import { escapeHtml, sanitizeEmailHtml } from '../utils/html-sanitize';

function renderableEmailContent(html) {
	const { document } = parseHTML(html);
	const body = document.querySelector('body');

	if (!body) {
		return { bodyStyle: '', content: document.toString() };
	}

	return {
		bodyStyle: body.getAttribute('style') || '',
		content: body.innerHTML
	};
}

export default function emailHtmlTemplate(html, domain) {
	const sanitizedHtml = sanitizeEmailHtml(html)
		.replace(/{{domain}}/g, domainUtils.toOssDomain(domain) + '/');
	const { bodyStyle, content } = renderableEmailContent(sanitizedHtml);
	const bodyStyleAttribute = bodyStyle ? ` style="${escapeHtml(bodyStyle)}"` : '';

	return `<!DOCTYPE html>
<html lang='en'>
<head>
    <meta charset='UTF-8'>
    <meta name='viewport' content='width=device-width, initial-scale=1.0'>
    <style>
        html,
        body {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
            background: #FFF;
            width: 100%;
            min-height: 100%;
        }

        .content-box {
            box-sizing: border-box;
            padding: 15px 10px;
            width: 100%;
            height: 100%;
            overflow: auto;
        }

        .content-html {
            box-sizing: border-box;
            width: 100%;
            min-height: 100%;
            font-family: Inter, -apple-system, BlinkMacSystemFont,
                         'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            font-size: 14px;
            line-height: 1.5;
            color: #13181D;
            word-break: break-word;
        }

        .content-html h1,
        .content-html h2,
        .content-html h3,
        .content-html h4 {
            font-size: 18px;
            font-weight: 700;
        }

        .content-html p {
            margin: 0;
        }

        .content-html a {
            text-decoration: none;
            color: #0E70DF;
        }

        .content-html img:not(table img) {
            max-width: 100% !important;
            height: auto !important;
        }
    </style>
</head>
<body>
    <div class='content-box'>
        <div id='container' class='content-html'${bodyStyleAttribute}>${content}</div>
    </div>
</body>
</html>`;
}
