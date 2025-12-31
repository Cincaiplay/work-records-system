  (function () {
    // 1) Remove success/error from URL after page load (so message doesn't persist)
    const url = new URL(window.location.href);
    const hadFlash = url.searchParams.has("success") || url.searchParams.has("error");
    if (hadFlash) {
      url.searchParams.delete("success");
      url.searchParams.delete("error");
      history.replaceState({}, "", url.toString());
    }

    // 2) When a tab is shown, update the URL ?tab=...
    const tabButtons = document.querySelectorAll('#mgmtTabs [data-bs-toggle="pill"]');

    tabButtons.forEach(btn => {
      btn.addEventListener("shown.bs.tab", (event) => {
        const targetSel = event.target.getAttribute("data-bs-target"); // e.g. #pane-roles
        const tabName = targetSel?.replace("#pane-", "") || "users";

        const u = new URL(window.location.href);
        u.searchParams.set("tab", tabName);

        // Optional: only keep perm pagination params when you're on perms tab
        if (tabName !== "perms") {
          u.searchParams.delete("permPage");
          u.searchParams.delete("permPageSize");
        } else {
          // ensure defaults exist if you want
          if (!u.searchParams.get("permPage")) u.searchParams.set("permPage", "1");
          if (!u.searchParams.get("permPageSize")) u.searchParams.set("permPageSize", "10");
        }

        // Always clear flash params on tab switch too
        u.searchParams.delete("success");
        u.searchParams.delete("error");

        history.replaceState({}, "", u.toString());
      });
    });
  })();
