'use client';

import React, { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import SystemSetupWizard from './SystemSetupWizard';

interface SetupGuardProps {
  children: React.ReactNode;
  user: any;
}

export default function SetupGuard({ children, user }: SetupGuardProps) {
  const [setupCompleted, setSetupCompleted] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const pathname = usePathname();

  // Pages that don't require setup (login, public pages, etc.)
  const exemptPaths = ['/login', '/signup', '/reset-password', '/auth'];

  useEffect(() => {
    checkSetupStatus();
  }, [user]);

  const checkSetupStatus = async () => {
    // If not logged in, skip setup check
    if (!user) {
      setSetupCompleted(true);
      setLoading(false);
      return;
    }

    // If on exempt path, skip setup check
    if (exemptPaths.some((path) => pathname?.startsWith(path))) {
      setSetupCompleted(true);
      setLoading(false);
      return;
    }

    try {
      const response = await fetch('/api/system-setup/status');
      if (response.ok) {
        const data = await response.json();
        setSetupCompleted(data.setupCompleted);
      } else {
        // If error, assume setup not complete
        setSetupCompleted(false);
      }
    } catch (err) {
      console.error('Failed to check setup status:', err);
      // On error, assume setup not complete
      setSetupCompleted(false);
    } finally {
      setLoading(false);
    }
  };

  const handleSetupComplete = () => {
    setSetupCompleted(true);
  };

  // Show loading state briefly while checking
  if (loading) {
    return <>{children}</>;
  }

  // If setup not completed and user is logged in, show setup wizard
  if (setupCompleted === false && user) {
    return (
      <>
        {children}
        <SystemSetupWizard onSetupComplete={handleSetupComplete} />
      </>
    );
  }

  // Setup complete or not required
  return <>{children}</>;
}
