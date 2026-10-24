import { Route, Routes } from 'react-router-dom';
import { RequireAuth } from '@/lib/auth-context';
import { MarketingLayout } from '@/components/MarketingLayout';
import { AdaptiveLayout } from '@/components/AdaptiveLayout';
import { AppLayout } from '@/components/AppLayout';
import Landing from '@/pages/Landing';
import { About, HowItWorks, NotFound, PracticeCatalogue, Privacy, SamplePage, Terms } from '@/pages/Public';
import { ForgotPassword, Login, Register, ResetPassword } from '@/pages/Auth';
import Dashboard from '@/pages/Dashboard';
import TestOverview from '@/pages/TestOverview';
import Attempt from '@/pages/Attempt';
import Results from '@/pages/Results';
import History from '@/pages/History';
import MistakeVault from '@/pages/MistakeVault';
import { PracticeSession, RecommendedPractice } from '@/pages/Practice';
import Progress from '@/pages/Progress';
import Settings from '@/pages/Settings';
import AdminNotAvailable from '@/pages/Admin';

export function App() {
  return (
    <Routes>
      {/* Public — dark landing */}
      <Route element={<MarketingLayout dark />}><Route path="/" element={<Landing />} /></Route>

      {/* Public — light pages (signed-in learners see them inside the app shell) */}
      <Route element={<AdaptiveLayout />}>
        <Route path="/practice" element={<PracticeCatalogue />} />
      </Route>
      <Route element={<MarketingLayout />}>
        <Route path="/how-it-works" element={<HowItWorks />} />
        <Route path="/sample" element={<SamplePage />} />
        <Route path="/about" element={<About />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
      </Route>

      {/* Auth (own full-page shell) */}
      <Route path="/auth/login" element={<Login />} />
      <Route path="/auth/register" element={<Register />} />
      <Route path="/auth/forgot-password" element={<ForgotPassword />} />
      <Route path="/auth/reset-password" element={<ResetPassword />} />

      {/* Authenticated — app shell */}
      <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/tests/:testId" element={<TestOverview />} />
        <Route path="/results/:attemptId" element={<Results />} />
        <Route path="/history" element={<History />} />
        <Route path="/mistake-vault" element={<MistakeVault />} />
        <Route path="/practice/recommended" element={<RecommendedPractice />} />
        <Route path="/practice/session/:sessionId" element={<PracticeSession />} />
        <Route path="/progress" element={<Progress />} />
        <Route path="/settings" element={<Settings />} />
      </Route>

      {/* Authenticated — full-screen, distraction-free exam (no app chrome) */}
      <Route path="/attempts/:attemptId" element={<RequireAuth><Attempt /></RequireAuth>} />

      {/* Admin — placeholders; real enforcement is server-side (not built yet) */}
      {['/admin', '/admin/tests', '/admin/questions', '/admin/media'].map((p) => (
        <Route key={p} path={p} element={<RequireAuth><AdminNotAvailable /></RequireAuth>} />
      ))}

      <Route element={<MarketingLayout />}><Route path="*" element={<NotFound />} /></Route>
    </Routes>
  );
}
