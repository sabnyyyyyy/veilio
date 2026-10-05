module.exports = [
"[externals]/crypto [external] (crypto, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("crypto", () => require("crypto"));

module.exports = mod;
}),
"[externals]/fs [external] (fs, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("fs", () => require("fs"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/@opentelemetry/api [external] (next/dist/compiled/@opentelemetry/api, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/compiled/@opentelemetry/api", () => require("next/dist/compiled/@opentelemetry/api"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/next-server/app-page-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-page-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-page-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/next-server/app-route-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-route-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/app-route-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/action-async-storage.external.js [external] (next/dist/server/app-render/action-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/server/app-render/action-async-storage.external.js", () => require("next/dist/server/app-render/action-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/after-task-async-storage.external.js [external] (next/dist/server/app-render/after-task-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/server/app-render/after-task-async-storage.external.js", () => require("next/dist/server/app-render/after-task-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-async-storage.external.js [external] (next/dist/server/app-render/work-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/server/app-render/work-async-storage.external.js", () => require("next/dist/server/app-render/work-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/app-render/work-unit-async-storage.external.js [external] (next/dist/server/app-render/work-unit-async-storage.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/server/app-render/work-unit-async-storage.external.js", () => require("next/dist/server/app-render/work-unit-async-storage.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/server/runtime-reacts.external.js [external] (next/dist/server/runtime-reacts.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/server/runtime-reacts.external.js", () => require("next/dist/server/runtime-reacts.external.js"));

module.exports = mod;
}),
"[externals]/next/dist/shared/lib/no-fallback-error.external.js [external] (next/dist/shared/lib/no-fallback-error.external.js, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("next/dist/shared/lib/no-fallback-error.external.js", () => require("next/dist/shared/lib/no-fallback-error.external.js"));

module.exports = mod;
}),
"[externals]/node:stream [external] (node:stream, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("node:stream", () => require("node:stream"));

module.exports = mod;
}),
"[externals]/path [external] (path, cjs)", ((__turbopack_context__, module, exports) => {

var mod = __turbopack_context__.x("path", () => require("path"));

module.exports = mod;
}),
"[project]/.local-product-e2e/app/api/ipfs/upload/route.ts [app-route] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "POST",
    ()=>POST
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/server.js [app-route] (ecmascript)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$crypto__$5b$external$5d$__$28$crypto$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/crypto [external] (crypto, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$fs__$5b$external$5d$__$28$fs$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/fs [external] (fs, cjs)");
var __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__ = __turbopack_context__.i("[externals]/path [external] (path, cjs)");
;
;
;
;
/**
 * POST /api/ipfs/upload
 *
 * Handles two cases:
 *   A) application/json  → upload metadata JSON
 *   B) multipart/form-data → upload image file
 *
 * Priority order for image storage:
 *   1. Pinata IPFS (if PINATA_JWT or PINATA_API_KEY+PINATA_SECRET_API_KEY are set)
 *   2. Local public/uploads/ folder (returns a /uploads/<hash>.<ext> URL that
 *      works immediately without any external service)
 *
 * The old "fake CID" fallback has been removed — it generated a synthetic
 * Qm... hash that was never actually pinned to IPFS, so no gateway could
 * ever serve it.
 */ // Ensure /public/uploads/ exists at startup
const UPLOADS_DIR = __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["default"].join(process.cwd(), 'public', 'uploads');
if (!__TURBOPACK__imported__module__$5b$externals$5d2f$fs__$5b$external$5d$__$28$fs$2c$__cjs$29$__["default"].existsSync(UPLOADS_DIR)) {
    __TURBOPACK__imported__module__$5b$externals$5d2f$fs__$5b$external$5d$__$28$fs$2c$__cjs$29$__["default"].mkdirSync(UPLOADS_DIR, {
        recursive: true
    });
}
const EXT_MAP = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif'
};
async function POST(req) {
    try {
        const contentType = req.headers.get('content-type') || '';
        // ------------------------------------------------------------------
        // CASE A: METADATA JSON UPLOAD
        // ------------------------------------------------------------------
        if (contentType.includes('application/json')) {
            const body = await req.json();
            const metadata = body.metadata;
            if (!metadata) {
                return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
                    error: 'Missing metadata object'
                }, {
                    status: 400
                });
            }
            // Try Pinata first
            const pinataJwt = process.env.PINATA_JWT;
            const pinataApiKey = process.env.PINATA_API_KEY;
            const pinataSecret = process.env.PINATA_SECRET_API_KEY;
            if (pinataJwt || pinataApiKey && pinataSecret) {
                const headers = {
                    'Content-Type': 'application/json'
                };
                if (pinataJwt) {
                    headers['Authorization'] = `Bearer ${pinataJwt}`;
                } else {
                    headers['pinata_api_key'] = pinataApiKey;
                    headers['pinata_secret_api_key'] = pinataSecret;
                }
                try {
                    const pinataRes = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({
                            pinataContent: metadata,
                            pinataMetadata: {
                                name: `VEILIO_Metadata_${Date.now()}.json`
                            }
                        })
                    });
                    if (pinataRes.ok) {
                        const pinataData = await pinataRes.json();
                        const cid = pinataData.IpfsHash;
                        console.log('[IPFS upload] Metadata pinned to Pinata. CID:', cid);
                        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
                            success: true,
                            cid,
                            uri: `ipfs://${cid}`,
                            gatewayUrl: `https://gateway.pinata.cloud/ipfs/${cid}`
                        });
                    } else {
                        console.warn('[IPFS upload] Pinata metadata pin failed:', await pinataRes.text());
                    }
                } catch (pinataErr) {
                    console.warn('[IPFS upload] Pinata metadata request error:', pinataErr);
                }
            }
            // Fallback: store metadata as a local JSON file in /public/uploads/
            const jsonStr = JSON.stringify(metadata);
            const hash = __TURBOPACK__imported__module__$5b$externals$5d2f$crypto__$5b$external$5d$__$28$crypto$2c$__cjs$29$__["default"].createHash('sha256').update(jsonStr).digest('hex').substring(0, 32);
            const filename = `meta_${hash}.json`;
            const filePath = __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["default"].join(UPLOADS_DIR, filename);
            __TURBOPACK__imported__module__$5b$externals$5d2f$fs__$5b$external$5d$__$28$fs$2c$__cjs$29$__["default"].writeFileSync(filePath, jsonStr, 'utf8');
            const localUrl = `/uploads/${filename}`;
            console.log('[IPFS upload] Metadata stored locally:', localUrl);
            return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
                success: true,
                cid: hash,
                uri: localUrl,
                gatewayUrl: localUrl
            });
        }
        // ------------------------------------------------------------------
        // CASE B: IMAGE FILE UPLOAD
        // ------------------------------------------------------------------
        const formData = await req.formData();
        const file = formData.get('file');
        if (!file) {
            return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
                error: 'No image file provided'
            }, {
                status: 400
            });
        }
        // Validation: file type
        const validTypes = [
            'image/jpeg',
            'image/png',
            'image/webp'
        ];
        if (!validTypes.includes(file.type)) {
            return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
                error: 'Please upload a JPG, PNG, or WebP image.'
            }, {
                status: 400
            });
        }
        // Validation: file size max 5 MB
        const MAX_SIZE = 5 * 1024 * 1024;
        if (file.size > MAX_SIZE) {
            return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
                error: 'Image must be smaller than 5 MB.'
            }, {
                status: 400
            });
        }
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        // Try Pinata IPFS pinning service if credentials present
        const pinataJwt = process.env.PINATA_JWT;
        const pinataApiKey = process.env.PINATA_API_KEY;
        const pinataSecret = process.env.PINATA_SECRET_API_KEY;
        if (pinataJwt || pinataApiKey && pinataSecret) {
            const pinataFormData = new FormData();
            const blob = new Blob([
                buffer
            ], {
                type: file.type
            });
            pinataFormData.append('file', blob, file.name);
            const headers = {};
            if (pinataJwt) {
                headers['Authorization'] = `Bearer ${pinataJwt}`;
            } else {
                headers['pinata_api_key'] = pinataApiKey;
                headers['pinata_secret_api_key'] = pinataSecret;
            }
            try {
                const pinataRes = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
                    method: 'POST',
                    headers,
                    body: pinataFormData
                });
                if (pinataRes.ok) {
                    const pinataData = await pinataRes.json();
                    const cid = pinataData.IpfsHash;
                    console.log('[IPFS upload] Image pinned to Pinata. CID:', cid);
                    return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
                        success: true,
                        cid,
                        uri: `ipfs://${cid}`,
                        gatewayUrl: `https://gateway.pinata.cloud/ipfs/${cid}`
                    });
                } else {
                    console.warn('[IPFS upload] Pinata image pin failed:', await pinataRes.text());
                }
            } catch (pinataErr) {
                console.warn('[IPFS upload] Pinata image request error:', pinataErr);
            }
        }
        // Fallback: store image locally in /public/uploads/<hash>.<ext>
        // This is a real, working URL — not a fake CID.
        const hash = __TURBOPACK__imported__module__$5b$externals$5d2f$crypto__$5b$external$5d$__$28$crypto$2c$__cjs$29$__["default"].createHash('sha256').update(buffer).digest('hex').substring(0, 32);
        const ext = EXT_MAP[file.type] || 'jpg';
        const filename = `img_${hash}.${ext}`;
        const filePath = __TURBOPACK__imported__module__$5b$externals$5d2f$path__$5b$external$5d$__$28$path$2c$__cjs$29$__["default"].join(UPLOADS_DIR, filename);
        __TURBOPACK__imported__module__$5b$externals$5d2f$fs__$5b$external$5d$__$28$fs$2c$__cjs$29$__["default"].writeFileSync(filePath, buffer);
        const localUrl = `/uploads/${filename}`;
        console.log('[IPFS upload] Image stored locally:', localUrl);
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            success: true,
            cid: hash,
            uri: localUrl,
            gatewayUrl: localUrl
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Internal server error during IPFS upload';
        console.error('[IPFS upload] Server route error:', err);
        return __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$server$2e$js__$5b$app$2d$route$5d$__$28$ecmascript$29$__["NextResponse"].json({
            error: message
        }, {
            status: 500
        });
    }
}
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__1qxbipy._.js.map