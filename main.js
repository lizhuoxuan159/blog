const WORKER_BASE = "https://你的worker地址.workers.dev";
const TURNSTILE_SITEKEY = "你的Turnstile SiteKey";

// 页面加载时统计访问
function sendVisitStat(postPath) {
  fetch(`${WORKER_BASE}/api/visit?post=${encodeURIComponent(postPath)}`);
  // 获取阅读量
  fetch(`${WORKER_BASE}/api/stats/view?post=${encodeURIComponent(postPath)}`)
    .then(r=>r.json())
    .then(d=>{
      document.getElementById("view-count").innerText = `阅读：${d.count}`;
    })
}

// 加载评论
async function loadComments(postPath) {
  const res = await fetch(`${WORKER_BASE}/api/comment/list?post=${encodeURIComponent(postPath)}`);
  const list = await res.json();
  let html = `<h4>评论区</h4><div id="comment-list">`;
  if(list.length === 0) html += "<p>暂无评论</p>";
  list.forEach(item => {
    html += `
      <div class="comment-item">
        <div class="time">${item.create_time}</div>
        <div class="text">${item.content}</div>
      </div>
    `;
  });
  html += "</div>";
  document.querySelector("#content").insertAdjacentHTML("beforeend", html);
}

// 提交评论
async function submitComment() {
  const content = document.getElementById("comment-content").value.trim();
  const postPath = location.pathname;
  const msgBox = document.getElementById("msg");
  if (!content) return msgBox.innerText = "评论不能为空";

  // 获取turnstile token
  const token = await turnstile.getResponse(document.querySelector(".cf-turnstile"));
  if (!token) return msgBox.innerText = "请完成人机验证";

  try {
    const resp = await fetch(`${WORKER_BASE}/api/comment/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, content, post: postPath })
    });
    const data = await resp.json();
    if (data.success) {
      msgBox.innerText = "发布成功，刷新加载评论";
      setTimeout(()=>location.reload(),1000);
    } else {
      msgBox.innerText = data.msg;
    }
  } catch (e) {
    msgBox.innerText = "网络请求失败";
  }
}

// 文章渲染入口
async function renderPost(path) {
  const res = await fetch(path);
  const mdText = await res.text();
  document.getElementById("content").innerHTML = marked.parse(mdText);
  sendVisitStat(path);
  loadComments(path);
}

window.onload = () => {
  const hash = location.hash.slice(1);
  if (hash && hash.startsWith("post/")) {
    renderPost(hash);
  }
}
