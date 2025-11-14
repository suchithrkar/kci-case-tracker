<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>KCI Case Tracker — Login</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body style="display:grid;place-items:center;height:100vh;">
  <div style="width:360px;padding:20px;border-radius:12px;background:var(--panel, #fff);box-shadow:0 8px 30px rgba(0,0,0,.06);">
    <h2 style="margin-top:0">KCI Case Tracker</h2>

    <label>Email</label>
    <input id="email" type="email" style="width:100%;padding:.6rem;margin:.35rem 0;border-radius:8px" />

    <label>Password</label>
    <input id="password" type="password" style="width:100%;padding:.6rem;margin:.35rem 0;border-radius:8px" />

    <div style="display:flex;gap:.5rem;margin-top:.6rem;">
      <button id="loginBtn" style="flex:1;padding:.6rem">Login</button>
      <button id="toggleMode" style="padding:.6rem">Don’t have an account? Sign up</button>
    </div>

    <div style="margin-top:.6rem;display:flex;justify-content:space-between;align-items:center;">
      <a id="forgotLink" href="#" style="font-size:13px">Forgot password?</a>
      <span id="status" style="font-size:13px;color:#666"></span>
    </div>
  </div>

  <script type="module" src="./login.js"></script>
</body>
</html>
