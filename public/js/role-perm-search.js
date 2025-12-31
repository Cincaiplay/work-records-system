document.addEventListener("input", (e) => {
  const input = e.target;
  const roleId = input.getAttribute("data-perm-search");
  if (!roleId) return;

  const q = (input.value || "").trim().toLowerCase();

  const items = document.querySelectorAll(`.perm-item[data-role="${roleId}"]`);
  items.forEach((el) => {
    const text = el.getAttribute("data-text") || "";
    el.style.display = text.includes(q) ? "" : "none";
  });
});
