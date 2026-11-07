const progressBar = document.querySelector(".scroll-progress-bar");
const circle = document.querySelector(".progress-circle circle");
const arrowIcon = document.getElementById("arrowIcon");
const btn = document.getElementById("scrollBtn");

const circumference = 283;

window.addEventListener("scroll", () => {
  const scrollTotal =
    document.documentElement.scrollHeight - window.innerHeight;
  const scrollCurrent = window.scrollY;
  const progress = scrollCurrent / scrollTotal;

  // 1. 同步顶部进度条
  progressBar.style.width = `${progress * 100}%`;

  // 2. 同步圆形进度条
  circle.style.strokeDashoffset = circumference - progress * circumference;

  // 3. 核心逻辑：滚动过半时切换状态
  if (progress > 0.5) {
    // 到底部了：箭头向上，点击返回顶部
    arrowIcon.style.transform = "rotate(0deg)";
    btn.dataset.direction = "top";
  } else {
    // 在顶部：箭头向下，点击跳到底部
    arrowIcon.style.transform = "rotate(180deg)";
    btn.dataset.direction = "bottom";
  }
});

// 4. 点击执行逻辑
btn.addEventListener("click", () => {
  const direction = btn.dataset.direction;
  const target =
    direction === "bottom" ? document.documentElement.scrollHeight : 0;

  window.scrollTo({
    top: target,
    behavior: "smooth",
  });
});
