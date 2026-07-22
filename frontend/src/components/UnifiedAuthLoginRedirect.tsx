import { useEffect } from 'react';
import { redirectToLogin } from '../utils/loginRedirect';

type Props = {
  returnTo: string;
};

export default function UnifiedAuthLoginRedirect({ returnTo }: Props) {
  useEffect(() => {
    void redirectToLogin(returnTo);
  }, [returnTo]);

  return null;
}
