import DefaultTheme from 'vitepress/theme'
import ProductHome from './ProductHome.vue'
import ProductHomeEn from './ProductHomeEn.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('ProductHome', ProductHome)
    app.component('ProductHomeEn', ProductHomeEn)
  },
}
