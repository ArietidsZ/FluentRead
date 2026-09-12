/**
 * @file src/core/i18n/messages/legacy-corrections.ts
 * 文件职责：人工校正旧界面文案中机器补齐造成的误译、直译和术语不一致，作为各语言旧文案词典的最后一层覆盖。
 * 主要内容：按“中文原文 + English、日本語、한국어、Français、Русский、Español”七列登记校正后的完整译文，并由 createLegacyCorrectionText 按语言展开。
 * 模块边界：只提供纯数据，不读取配置、不访问浏览器；新界面仍应使用稳定 message key，这里只修正仍在界面中使用的旧中文文案。
 */
import type {RegisteredUiLanguage} from '../types';

/** 中文原文，随后依次为 English、日本語、한국어、Français、Русский、Español。 */
type LegacyCorrectionRow = readonly [source: string, enUS: string, jaJP: string, koKR: string, frFR: string, ruRU: string, esES: string];

/** 设置页、弹窗、文档页和各功能面板中的标签、按钮与说明。 */
const correctionRows: readonly LegacyCorrectionRow[] = [
    ['快捷键', 'Shortcuts', 'ショートカット', '단축키', 'Raccourcis clavier', 'Сочетания клавиш', 'Atajos de teclado'],
    ['自定义快捷键', 'Custom shortcuts', 'カスタムショートカット', '사용자 지정 단축키', 'Raccourcis personnalisés', 'Пользовательские сочетания клавиш', 'Atajos personalizados'],
    ['⠿ 拖动卡片可排序', '⠿ Drag cards to reorder', '⠿ カードをドラッグして並べ替え', '⠿ 카드를 끌어 순서 변경', '⠿ Glissez les cartes pour les réordonner', '⠿ Перетащите карточки, чтобы изменить порядок', '⠿ Arrastra las tarjetas para reordenarlas'],
    ['JSON 字符串路径翻译表格', 'JSON string path translation table', 'JSON 文字列パスの翻訳表', 'JSON 문자열 경로 번역 표', 'Tableau de traduction des chemins de chaînes JSON', 'Таблица перевода строк JSON по путям', 'Tabla de traducción de rutas de cadenas JSON'],
    ['MiniMax API 区域', 'MiniMax API region', 'MiniMax API リージョン', 'MiniMax API 리전', 'Région de l’API MiniMax', 'Регион API MiniMax', 'Región de la API de MiniMax'],
    ['MiniMax 区域', 'MiniMax region', 'MiniMax リージョン', 'MiniMax 리전', 'Région MiniMax', 'Регион MiniMax', 'Región de MiniMax'],
    ['NewAPI接口', 'NewAPI endpoint', 'NewAPI エンドポイント', 'NewAPI 엔드포인트', 'Point de terminaison NewAPI', 'Endpoint NewAPI', 'Endpoint de NewAPI'],
    ['PDF 版式翻译预览', 'PDF layout translation preview', 'PDF レイアウト翻訳のプレビュー', 'PDF 레이아웃 번역 미리 보기', 'Aperçu de la traduction avec mise en page PDF', 'Предпросмотр перевода PDF с вёрсткой', 'Vista previa de la traducción con diseño PDF'],
    ['PDF 连续页面阅读状态', 'PDF continuous reading status', 'PDF の連続ページ閲覧状態', 'PDF 연속 페이지 읽기 상태', 'État de lecture continue du PDF', 'Состояние непрерывного чтения PDF', 'Estado de lectura continua del PDF'],
    ['PDF 预览缩放', 'PDF preview zoom', 'PDF プレビューの倍率', 'PDF 미리 보기 확대/축소', 'Zoom de l’aperçu PDF', 'Масштаб предпросмотра PDF', 'Zoom de la vista previa PDF'],
    ['Token Plan 必须使用购买页面提供的集群地址；中国、新加坡和欧洲集群的 tp- Key 不能混用。按量付费统一使用 api.xiaomimimo.com。', 'Token Plan keys must use the cluster address from the purchase page; tp- keys for the China, Singapore, and Europe clusters are not interchangeable. Pay-as-you-go keys always use api.xiaomimimo.com.', 'Token Plan では購入ページに記載されたクラスターアドレスを使用してください。中国、シンガポール、ヨーロッパの各クラスターの tp- キーは相互に使えません。従量課金はすべて api.xiaomimimo.com を使用します。', 'Token Plan은 구매 페이지에 안내된 클러스터 주소를 사용해야 하며, 중국·싱가포르·유럽 클러스터의 tp- 키는 서로 바꿔 쓸 수 없습니다. 종량제는 모두 api.xiaomimimo.com을 사용합니다.', 'Les clés Token Plan doivent utiliser l’adresse du cluster indiquée sur la page d’achat ; les clés tp- des clusters Chine, Singapour et Europe ne sont pas interchangeables. Le paiement à l’usage utilise toujours api.xiaomimimo.com.', 'Для Token Plan используйте адрес кластера со страницы покупки; ключи tp- кластеров Китая, Сингапура и Европы не взаимозаменяемы. Оплата по факту всегда использует api.xiaomimimo.com.', 'Token Plan debe usar la dirección del clúster indicada en la página de compra; las claves tp- de los clústeres de China, Singapur y Europa no son intercambiables. El pago por uso siempre usa api.xiaomimimo.com.'],
    ['Token 使用量', 'Token usage', 'トークン使用量', '토큰 사용량', 'Utilisation des tokens', 'Использование токенов', 'Uso de tokens'],
    ['Token 明细', 'Token details', 'トークンの内訳', '토큰 세부 정보', 'Détail des tokens', 'Детализация токенов', 'Detalle de tokens'],
    ['Word 文档部分', 'Word document sections', 'Word 文書のセクション', 'Word 문서 섹션', 'Sections du document Word', 'Разделы документа Word', 'Secciones del documento Word'],
    ['Word 文档页面预览', 'Word document page preview', 'Word 文書ページのプレビュー', 'Word 문서 페이지 미리 보기', 'Aperçu des pages du document Word', 'Предпросмотр страниц документа Word', 'Vista previa de las páginas del documento Word'],
    ['为当前功能设置一个顺手、易记且不容易冲突的按键组合。', 'Choose a comfortable, memorable key combination for this feature that is unlikely to conflict with others.', 'この機能に、押しやすく覚えやすい、他と競合しにくいキーの組み合わせを設定します。', '이 기능에 누르기 편하고 기억하기 쉬우며 다른 단축키와 충돌하지 않는 키 조합을 설정하세요.', 'Choisissez pour cette fonction une combinaison de touches pratique, facile à retenir et peu susceptible d’entrer en conflit.', 'Задайте для этой функции удобное и запоминающееся сочетание клавиш, которое вряд ли будет конфликтовать с другими.', 'Elige para esta función una combinación de teclas cómoda, fácil de recordar y que no entre en conflicto con otras.'],
    ['也可以直接录制', 'Or record it directly', 'キーを押して直接記録することもできます', '키를 눌러 바로 기록할 수도 있습니다', 'Vous pouvez aussi l’enregistrer directement', 'Сочетание можно также записать напрямую', 'También puedes grabarlo directamente'],
    ['仅记录时间、服务与模型、调用场景、状态、耗时及服务商返回的 Token；不保存原文、译文、提示词、网页地址、API Key、请求体或响应正文。', 'Only the time, service and model, usage scenario, status, duration, and tokens reported by the provider are recorded. Source text, translations, prompts, page URLs, API keys, request bodies, and response bodies are never saved.', '記録するのは日時、サービスとモデル、利用場面、状態、所要時間、サービスが返したトークン数だけです。原文、訳文、プロンプト、ページ URL、API キー、リクエストボディ、レスポンス本文は保存しません。', '시간, 서비스와 모델, 호출 상황, 상태, 소요 시간, 서비스가 반환한 토큰만 기록합니다. 원문, 번역문, 프롬프트, 웹페이지 주소, API 키, 요청 본문, 응답 본문은 저장하지 않습니다.', 'Seuls l’heure, le service et le modèle, le contexte d’appel, l’état, la durée et les tokens renvoyés par le fournisseur sont enregistrés. Le texte source, les traductions, les prompts, les URL, les clés API et les corps de requête ou de réponse ne sont jamais conservés.', 'Записываются только время, сервис и модель, сценарий вызова, статус, длительность и токены, которые вернул провайдер. Исходный текст, переводы, промпты, адреса страниц, API-ключи, тела запросов и ответов не сохраняются.', 'Solo se registran la hora, el servicio y el modelo, el contexto de uso, el estado, la duración y los tokens que devuelve el proveedor. Nunca se guardan el texto original, las traducciones, los prompts, las direcciones web, las claves API ni los cuerpos de solicitud o respuesta.'],
    ['会删除本机请求记录及其汇总；不会删除 API Key、翻译设置、FluentRead 译文缓存或配置历史。此操作无法撤销。', 'This deletes local request records and their summaries. API keys, translation settings, the FluentRead translation cache, and settings history are not deleted. This cannot be undone.', 'この端末のリクエスト記録とその集計を削除します。API キー、翻訳設定、FluentRead の翻訳キャッシュ、設定履歴は削除されません。この操作は元に戻せません。', '이 기기의 요청 기록과 집계를 삭제합니다. API 키, 번역 설정, FluentRead 번역 캐시, 설정 기록은 삭제되지 않습니다. 이 작업은 되돌릴 수 없습니다.', 'Les enregistrements de requêtes locaux et leurs synthèses seront supprimés. Les clés API, les réglages de traduction, le cache de traduction FluentRead et l’historique des réglages sont conservés. Cette action est irréversible.', 'Будут удалены локальные записи запросов и их сводки. API-ключи, настройки перевода, кэш переводов FluentRead и история настроек сохранятся. Это действие нельзя отменить.', 'Se eliminarán los registros locales de solicitudes y sus resúmenes. No se eliminan las claves API, la configuración de traducción, la caché de traducciones de FluentRead ni el historial de configuración. Esta acción no se puede deshacer.'],
    ['例如：{"thinking": {"type": "disabled"}}', 'For example: {"thinking": {"type": "disabled"}}', '例：{"thinking": {"type": "disabled"}}', '예: {"thinking": {"type": "disabled"}}', 'Par exemple : {"thinking": {"type": "disabled"}}', 'Например: {"thinking": {"type": "disabled"}}', 'Por ejemplo: {"thinking": {"type": "disabled"}}'],
    ['例如：gpt-4.1-mini', 'For example: gpt-4.1-mini', '例：gpt-4.1-mini', '예: gpt-4.1-mini', 'Par exemple : gpt-4.1-mini', 'Например: gpt-4.1-mini', 'Por ejemplo: gpt-4.1-mini'],
    ['例如：本地 Ollama', 'For example: Local Ollama', '例：ローカル Ollama', '예: 로컬 Ollama', 'Par exemple : Ollama local', 'Например: локальный Ollama', 'Por ejemplo: Ollama local'],
    ['保存服务', 'Save service', 'サービスを保存', '서비스 저장', 'Enregistrer le service', 'Сохранить сервис', 'Guardar servicio'],
    ['保留原版式', 'Original layout kept', '元のレイアウトを保持', '원래 레이아웃 유지', 'Mise en page d’origine conservée', 'Исходная вёрстка сохранена', 'Diseño original conservado'],
    ['修改会自动保存到当前 AI 服务；可用变量可以一键插入。', 'Changes save automatically to the current AI service; insert available variables with one click.', '変更は現在の AI サービスに自動保存されます。利用できる変数はワンクリックで挿入できます。', '변경 사항은 현재 AI 서비스에 자동 저장되며, 사용 가능한 변수를 한 번에 삽입할 수 있습니다.', 'Les modifications sont enregistrées automatiquement pour le service IA actuel ; insérez les variables disponibles en un clic.', 'Изменения автоматически сохраняются для текущего ИИ-сервиса; доступные переменные вставляются одним нажатием.', 'Los cambios se guardan automáticamente en el servicio de IA actual; inserta las variables disponibles con un clic.'],
    ['关闭圈选翻译结果', 'Close area translation result', '範囲翻訳の結果を閉じる', '영역 번역 결과 닫기', 'Fermer le résultat de la traduction de zone', 'Закрыть результат перевода области', 'Cerrar el resultado de la traducción de área'],
    ['关闭更多服务', 'Close service picker', 'サービスの選択を閉じる', '서비스 선택 닫기', 'Fermer la sélection de services', 'Закрыть выбор сервисов', 'Cerrar el selector de servicios'],
    ['关闭翻译结果', 'Close translation result', '翻訳結果を閉じる', '번역 결과 닫기', 'Fermer le résultat de traduction', 'Закрыть результат перевода', 'Cerrar el resultado de la traducción'],
    ['关闭自定义快捷键', 'Close custom shortcut dialog', 'カスタムショートカットを閉じる', '사용자 지정 단축키 닫기', 'Fermer la boîte de dialogue du raccourci personnalisé', 'Закрыть окно пользовательского сочетания клавиш', 'Cerrar el diálogo de atajo personalizado'],
    ['划词显示延迟', 'Selection translation delay', '選択範囲の翻訳の表示遅延', '선택 영역 번역 표시 지연', 'Délai d’affichage de la traduction de la sélection', 'Задержка показа перевода выделенного текста', 'Retraso de la traducción de la selección'],
    ['划词翻译结果', 'Selection translation result', '選択範囲の翻訳結果', '선택 영역 번역 결과', 'Résultat de la traduction de la sélection', 'Результат перевода выделенного текста', 'Resultado de la traducción de la selección'],
    ['划词翻译触发方式', 'Selection translation trigger', '選択範囲の翻訳の起動方法', '선택 영역 번역 실행 방식', 'Déclenchement de la traduction de la sélection', 'Способ запуска перевода выделенного текста', 'Activación de la traducción de la selección'],
    ['划词翻译语音回退顺序', 'Selection translation voice fallback order', '選択範囲の翻訳の音声フォールバック順', '선택 영역 번역 음성 대체 순서', 'Ordre des voix de secours de la traduction de la sélection', 'Порядок резервных голосов для перевода выделенного текста', 'Orden de voces alternativas de la traducción de la selección'],
    ['删除服务', 'Delete service', 'サービスを削除', '서비스 삭제', 'Supprimer le service', 'Удалить сервис', 'Eliminar servicio'],
    ['原有图片翻译偏好和语言包记录会保留；请在 Chrome 中使用及管理此功能。', 'Your existing image translation preferences and language pack records are kept. Use and manage this feature in Chrome.', '既存の画像翻訳の設定と言語パックの記録は保持されます。この機能は Chrome で使用・管理してください。', '기존 이미지 번역 설정과 언어 팩 기록은 유지됩니다. 이 기능은 Chrome에서 사용하고 관리하세요.', 'Vos préférences de traduction d’images et l’état des modules linguistiques sont conservés. Utilisez et gérez cette fonction dans Chrome.', 'Текущие настройки перевода изображений и сведения о языковых пакетах сохранятся. Используйте и настраивайте эту функцию в Chrome.', 'Se conservan tus preferencias de traducción de imágenes y los registros de paquetes de idioma. Usa y gestiona esta función en Chrome.'],
    ['去配置', 'Configure', '設定する', '설정하기', 'Configurer', 'Настроить', 'Configurar'],
    ['可插入的提示词变量', 'Insertable prompt variables', '挿入できるプロンプト変数', '삽입할 수 있는 프롬프트 변수', 'Variables de prompt à insérer', 'Переменные промпта для вставки', 'Variables de prompt que puedes insertar'],
    ['可选的代理地址；填写后，当前 AI 服务请求会优先发送到这里。', 'Optional proxy URL. When set, requests for the current AI service are sent here first.', '任意のプロキシ URL です。入力すると、現在の AI サービスへのリクエストは優先的にここへ送信されます。', '선택 사항인 프록시 주소입니다. 입력하면 현재 AI 서비스 요청을 우선 이 주소로 보냅니다.', 'Adresse de proxy facultative. Une fois renseignée, les requêtes du service IA actuel y sont envoyées en priorité.', 'Необязательный адрес прокси. Если он указан, запросы текущего ИИ-сервиса отправляются сначала сюда.', 'Dirección de proxy opcional. Si la indicas, las solicitudes del servicio de IA actual se envían aquí primero.'],
];

const LANGUAGE_COLUMNS: Readonly<Record<RegisteredUiLanguage, 1 | 2 | 3 | 4 | 5 | 6>> = {
    'en-US': 1,
    'ja-JP': 2,
    'ko-KR': 3,
    'fr-FR': 4,
    'ru-RU': 5,
    'es-ES': 6,
};

/** 返回全部校正原文，供契约测试核对仍在界面源码中使用。 */
export function getLegacyCorrectionSources(): string[] {
    return correctionRows.map(([source]) => source);
}

/** 按界面语言展开校正词典，由各语言目录作为最后一层合并进 legacyText。 */
export function createLegacyCorrectionText(language: RegisteredUiLanguage): Readonly<Record<string, string>> {
    const column = LANGUAGE_COLUMNS[language];
    return Object.fromEntries(correctionRows.map((row) => [row[0], row[column]]));
}
