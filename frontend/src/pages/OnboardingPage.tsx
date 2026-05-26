import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTasteStore } from '../stores/tasteStore';
import FavouritePicker from '../components/onboarding/FavouritePicker';

export default function OnboardingPage() {
  const navigate = useNavigate();
  const hasCompleted = useTasteStore((s) => s.hasCompletedOnboarding);

  useEffect(() => {
    if (hasCompleted) {
      navigate('/', { replace: true });
    }
  }, [hasCompleted, navigate]);

  if (hasCompleted) {
    return null;
  }

  const handleComplete = () => {
    navigate('/', { replace: true });
  };

  return <FavouritePicker onComplete={handleComplete} />;
}
