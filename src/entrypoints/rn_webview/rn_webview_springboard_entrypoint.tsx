(globalThis as { useHashRouter?: boolean }).useHashRouter = true;

import '../../styles';
import springboard from 'springboard';

import { AppLoadingScreen } from '../../components/AppLoadingScreen';
import applicationEntrypoint from '../app_springboard_entrypoint';

document.documentElement.classList.add('dark');
springboard.registerSplashScreen(AppLoadingScreen);

export default applicationEntrypoint;
