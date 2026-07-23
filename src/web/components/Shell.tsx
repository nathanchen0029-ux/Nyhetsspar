import type { PropsWithChildren } from "react";
import { NavLink } from "react-router-dom";

export function Shell({ children }: PropsWithChildren) {
  return (
    <div className="app-shell">
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
      <main id="main-content">{children}</main>
    </div>
  );
}
