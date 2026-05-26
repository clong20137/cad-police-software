# 🚀 Quick Start Guide

Get your CAD Police Software running in 3 minutes!

## Prerequisites
- Node.js 18+ installed
- Windows, macOS, or Linux

## Installation

### Option 1: Using VS Code Tasks (Easiest)

1. Open the project in VS Code
2. Press `Ctrl+Shift+P` → Search "Run Task"
3. Select **"Install All Dependencies"** and wait to complete
4. Select **"Dev - Frontend + Backend"** to start development

### Option 2: Using Terminal

```powershell
# Navigate to project
cd c:\Users\ISP\Desktop\CAD

# Install all dependencies
npm install                # Root packages
cd server && npm install   # Backend packages
cd ../client && npm install # Frontend packages
cd ..

# Start development
npm run dev
```

## Running the Project

### Start Everything (Default)
```powershell
npm run dev
```

### Start Only Backend
```powershell
npm run server
# Runs on http://localhost:5000
```

### Start Only Frontend
```powershell
npm run client
# Runs on http://localhost:3000
```

## Login

Open http://localhost:3000 in your browser and log in with one of these accounts:

### Admin User
- **Email**: admin@dispatch.local
- **Password**: admin123
- **Permissions**: Full system access

### Dispatcher User
- **Email**: dispatcher@dispatch.local
- **Password**: dispatcher123
- **Permissions**: Create & manage dispatch

### Officer User
- **Email**: officer@dispatch.local
- **Password**: officer123
- **Permissions**: View dispatch and officers

## Build for Production

```powershell
npm run build
```

Creates optimized builds in:
- `server/dist/` - Backend JavaScript
- `client/build/` - Frontend React app

## Understanding the Code

### Backend (Express + TypeScript)
- **File**: `server/src/index.ts` - Main Express app
- **Auth**: `server/src/middleware/auth.ts` - JWT & CSP
- **Routes**: `server/src/routes/auth.ts` - API endpoints
- **Services**: `server/src/services/AuthService.ts` - Auth logic

### Frontend (React + TypeScript)
- **File**: `client/src/App.tsx` - Main app with routing
- **Auth Context**: `client/src/context/AuthContext.tsx` - Global state
- **Login**: `client/src/components/LoginPage.tsx` - Login form
- **Dashboard**: `client/src/components/Dashboard.tsx` - Main UI
- **Protected**: `client/src/components/Protected.tsx` - Role-based rendering

### Shared Types
- **File**: `shared/src/types/index.ts` - User, role, permission types

## Key Features

✅ JWT + Refresh Token authentication
✅ Server-side permission enforcement
✅ 4 user roles with 9 permissions
✅ Strict CSP security headers
✅ Automatic token refresh
✅ Role-based UI rendering
✅ Modern responsive design
✅ Full TypeScript type safety

## Common Tasks

### Add New API Endpoint
1. Create route in `server/src/routes/`
2. Use `authMiddleware` & `requirePermission` decorators
3. Add types to `shared/src/types/`

### Add New Frontend Component
1. Create component in `client/src/components/`
2. Wrap with `<Protected>` for permissions
3. Use `useAuth()` hook for user info

### Change Environment Variables
1. Edit `.env` in server/
2. Edit `.env.local` in client/
3. Restart development server

### Debug Authentication Issues
1. Check browser console (F12)
2. Check network tab for API calls
3. Verify tokens in localStorage
4. Check server logs for JWT errors

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Port 3000/5000 in use | Change in `.env` files |
| "Module not found" | Run `npm install` again |
| Token errors | Verify `JWT_SECRET` in `.env` |
| Build fails | Delete `node_modules/`, reinstall |
| npm not found | Install Node.js from nodejs.org |

## Documentation

- [README.md](README.md) - Full project documentation
- [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md) - File organization
- [SETUP_COMPLETE.md](SETUP_COMPLETE.md) - Setup details
- [server/README.md](server/README.md) - Backend docs
- [client/README.md](client/README.md) - Frontend docs
- [.github/copilot-instructions.md](.github/copilot-instructions.md) - Dev guidelines

## Next: Explore the Code

1. **Start Development**: `npm run dev`
2. **Open http://localhost:3000**
3. **Login with admin@dispatch.local / admin123**
4. **Explore the dashboard**
5. **Modify components in `client/src/components/`**
6. **Add API routes in `server/src/routes/`**

## Architecture Overview

```
User Browser
     ↓ (https)
React App (3000)
     ↓ (jwt token)
Express Server (5000)
     ↓ (validates jwt + permissions)
API Response
```

## Security Notes

🔒 **Never commit `.env` files**
🔒 **Change JWT secrets in production**
🔒 **Always validate permissions server-side**
🔒 **Use HTTPS in production**

## Need Help?

1. Check error messages in terminal
2. Review documentation files
3. Check GitHub Issues
4. Review TypeScript error messages (VSCode)

---

**Ready to build?** 🚀

Run this now:
```powershell
npm run dev
```

Then visit http://localhost:3000
