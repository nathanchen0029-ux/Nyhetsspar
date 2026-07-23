import type { PropsWithChildren } from "react";
import { NavLink } from "react-router-dom";

export function Shell({ children }: PropsWithChildren) {
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        跳到主要内容
      </a>
      <header className="site-header">
        <NavLink className="brand" to="/">
          Nyhetsspår
        </NavLink>
        <nav aria-label="主导航">
          <NavLink to="/">今日课程</NavLink>
          <NavLink to="/history">历史</NavLink>
          <NavLink to="/known">已掌握</NavLink>
        </nav>
      </header>
      <main id="main-content" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
