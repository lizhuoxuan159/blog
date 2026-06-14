export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // 替换为jsdelivr国内加速源，解决raw访问异常
    const GH_CDN_BASE = "https://cdn.jsdelivr.net/gh/lizhuoxuan159/blog@main";
    const TURNSTILE_SECRET = env.TURNSTILE_SECRET;

    // 1. 提交评论 POST
    if (url.pathname === "/api/comment/submit" && request.method === "POST") {
      return await handleSubmitComment(request, env, TURNSTILE_SECRET);
    }

    // 2. 获取评论列表 GET
    if (url.pathname === "/api/comment/list") {
      const post = url.searchParams.get("post");
      return await getCommentList(post, env);
    }

    // 3. 访问统计埋点
    if (url.pathname === "/api/visit") {
      const post = url.searchParams.get("post");
      await recordVisit(post, request, env);
      return Response.json({ success: true });
    }

    // 4. 获取文章阅读量
    if (url.pathname === "/api/stats/view") {
      const post = url.searchParams.get("post");
      return await getPostViewCount(post, env);
    }

    // 反向代理静态文件路径处理
    let targetPath = url.pathname;
    if (targetPath === "/") targetPath = "/index.html";
    const ghUrl = new URL(GH_CDN_BASE + targetPath);
    
    let res;
    try {
      res = await fetch(ghUrl);
    } catch (e) {
      return new Response("静态资源加载失败", { status: 502 });
    }

    // 文件不存在返回404
    if (!res.ok) {
      return new Response("页面不存在", { status: 404 });
    }

    // 手动匹配正确MIME类型，修复源码直接输出问题
    const bodyText = await res.text();
    const contentType = getMimeType(targetPath);

    return new Response(bodyText, {
      headers: {
        "Content-Type": contentType,
        "cache-control": "public, max-age=180"
      }
    });
  }
};

// 匹配文件对应的MIME类型（核心修复渲染问题）
function getMimeType(path) {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (path.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  return "text/plain; charset=utf-8";
}

// Turnstile人机验证校验
async function verifyTurnstile(token, secret) {
  const formData = new FormData();
  formData.append("secret", secret);
  formData.append("response", token);
  const verifyRes = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: formData
  });
  return await verifyRes.json();
}

// XSS HTML转义防护
function escapeHtml(str) {
  return str
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// 提交评论逻辑
async function handleSubmitComment(req, env, secret) {
  try {
    const body = await req.json();
    const { token, content, post } = body;

    if (!token || !content || !post) {
      return Response.json({ success: false, msg: "参数缺失" }, { status: 400 });
    }

    const verify = await verifyTurnstile(token, secret);
    if (!verify.success) {
      return Response.json({ success: false, msg: "人机验证失败" }, { status: 403 });
    }

    const safeContent = escapeHtml(content.slice(0, 1000));
    const clientIp = req.headers.get("cf-connecting-ip") || "";
    const ua = req.headers.get("user-agent") || "";

    await env.DB.prepare(`
      INSERT INTO comments (post_path, content, ip, ua)
      VALUES (?, ?, ?, ?)
    `).bind(post, safeContent, clientIp, ua).run();

    return Response.json({ success: true, msg: "评论发布成功" });
  } catch (err) {
    return Response.json({ success: false, msg: "服务器异常：" + err.message }, { status: 500 });
  }
}

// 查询文章评论
async function getCommentList(postPath, env) {
  if (!postPath) return Response.json([], { status: 400 });
  const { results } = await env.DB.prepare(`
    SELECT id, content, create_time FROM comments
    WHERE post_path = ?
    ORDER BY create_time DESC
  `).bind(postPath).all();
  return Response.json(results);
}

// 记录访问数据
async function recordVisit(postPath, req, env) {
  if (!postPath) return;
  const ip = req.headers.get("cf-connecting-ip") || "";
  const ua = req.headers.get("user-agent") || "";
  await env.DB.prepare(`
    INSERT INTO visit_stats (post_path, ip, ua)
    VALUES (?, ?, ?)
  `).bind(postPath, ip, ua).run();
}

// 获取阅读总量
async function getPostViewCount(postPath, env) {
  const { results } = await env.DB.prepare(`
    SELECT total_visits FROM post_view_count WHERE post_path = ?
  `).bind(postPath).all();
  const count = results.length ? results[0].total_visits : 0;
  return Response.json({ count });
}
