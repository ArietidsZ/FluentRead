/**
 * @file src/features/settings/ui/incognitoRouteCopy.ts
 * 文件职责：提供扩展专用私密路线控件的七种界面语言文案。
 * 主要内容：沿用全局 UiLanguage 类型和选择，为服务、模型、失效状态与尚未接入范围提供完整本地化。
 * 模块边界：仅供被油猴构建排除的控件使用，避免把不可用功能文案加入油猴的固定远程资源；不建立第二份语言配置、不注册资源或访问存储。
 */
import type {UiLanguage} from '@/src/core/i18n';

const zh = {
    title: '私密翻译专用路线', service: '私密翻译服务', model: '私密翻译模型',
    emptyService: '未选择专用服务', emptyModel: '未选择专用模型', unavailable: '已失效',
    clear: '清空私密翻译专用路线', connection: '配置此服务的连接与模型列表',
    disabled: '专用路线未启用，沿用现有行为。', selected: '已选择', noModel: '此服务无需模型',
    invalid: '私密翻译服务或模型配置无效，请检查独立配置、请求体与端点模型。',
    rules: '两个字段都为空时沿用现有行为。无模型服务只选服务；AI 和本地服务必须显式选择模型。切换服务不会自动清空或替换模型。',
    scope: '已接入通用文本后台与输入框翻译；独立读写助手、字典查词和两套视频运行时仍未受此路线完整保护。选择成功不代表所有功能已支持。',
    containment: '配置专用路线后，尚未确认来源的图片、圈选区域、单词卡翻译和识图能力检测会暂时停止，普通页面也受影响。清空两个字段后恢复原有行为；字典查词不受此闭锁保护。',
    source: '来源无法确认时，启用专用路线的翻译会停止，设置仍可保存。无 tab 的 popup/side panel 可能不支持；Firefox 140 缺少 documentId，153 以上仍须具备精确上下文证据。私密专用路线暂不支持多模型对比。',
    spanning: '扩展保持 spanning；私密窗口能否打开文档页由浏览器决定，不会改成 split 或迁移已有数据。',
};
type Copy = Record<keyof typeof zh, string>;
const copies: Record<UiLanguage, Copy> = {
    'zh-CN': zh,
    'en-US': {
        title: 'Private translation route', service: 'Private translation provider', model: 'Private translation model',
        emptyService: 'No dedicated provider', emptyModel: 'No dedicated model', unavailable: 'Unavailable',
        clear: 'Clear private translation route', connection: 'Configure this provider and its model list',
        disabled: 'Dedicated route disabled; existing behavior applies.', selected: 'Selected', noModel: 'This provider needs no model',
        invalid: 'Invalid private provider or model. Check the dedicated selection, advanced body and endpoint model.',
        rules: 'Both fields empty preserves existing behavior. Providers without models need only a provider. AI/local providers require an explicit model. Changing provider never clears or substitutes the model.',
        scope: 'Generic text and typed input translation are connected. Independent reading/writing, dictionary lookup and both video runtimes remain outside complete protection. A saved selection does not enable every feature.',
        containment: 'With a dedicated route configured, image, area, word-card translation and vision probes without a verified source temporarily stop, including on regular pages. Clearing both fields restores existing behavior. Dictionary lookup is outside this guard.',
        source: 'Unknown source stops translation when a dedicated route is configured; settings still save. Tabless popups/side panels may be unsupported. Firefox 140 lacks documentId; 153+ still needs exact context evidence. Private multi-model comparison is unsupported.',
        spanning: 'The extension stays in spanning mode. The browser controls private document-page access; no split mode or data migration.',
    },
    'ja-JP': {
        title: 'プライベート翻訳の専用経路', service: '専用翻訳サービス', model: '専用翻訳モデル',
        emptyService: '専用サービス未選択', emptyModel: '専用モデル未選択', unavailable: '利用不可',
        clear: 'プライベート翻訳の専用経路をクリア', connection: 'サービス接続とモデル一覧を設定',
        disabled: '専用経路は無効です。従来の動作を使用します。', selected: '選択済み', noModel: 'モデル不要のサービス',
        invalid: '専用サービスまたはモデルが無効です。選択、詳細リクエスト本文、エンドポイントのモデルを確認してください。',
        rules: '両項目が空なら従来の動作を維持します。モデル不要のサービスはサービスだけ選択します。AI・ローカルはモデルの明示選択が必要です。サービス変更でモデルを自動変更しません。',
        scope: '汎用テキストと入力欄の翻訳は接続済みです。独立した読み書き、辞書検索、両動画ランタイムは完全な保護の対象外です。保存だけでは全機能に適用されません。',
        containment: '専用経路を設定すると、出所を確認できない画像・範囲・単語カード翻訳と画像能力テストは通常ページでも一時停止します。両項目をクリアすると従来の動作に戻ります。辞書検索はこの制限の対象外です。',
        source: '出所不明の翻訳は専用経路の設定時に停止します。設定の保存は可能です。タブのないポップアップ等は未対応の場合があります。Firefox 140にはdocumentIdがなく、153以降も正確な証拠が必要です。プライベートでの複数モデル比較は未対応です。',
        spanning: 'spanningを維持します。プライベートで文書ページを開けるかはブラウザーが決めます。splitへの変更やデータ移行は行いません。',
    },
    'ko-KR': {
        title: '비공개 번역 전용 경로', service: '비공개 번역 서비스', model: '비공개 번역 모델',
        emptyService: '전용 서비스 미선택', emptyModel: '전용 모델 미선택', unavailable: '사용 불가',
        clear: '비공개 번역 전용 경로 지우기', connection: '서비스 연결 및 모델 목록 설정',
        disabled: '전용 경로가 꺼져 있습니다. 기존 동작을 사용합니다.', selected: '선택됨', noModel: '모델이 필요 없는 서비스',
        invalid: '비공개 서비스 또는 모델 설정이 잘못되었습니다. 선택, 고급 요청 본문 및 엔드포인트 모델을 확인하세요.',
        rules: '두 항목이 비어 있으면 기존 동작을 유지합니다. 모델이 없는 서비스는 서비스만 선택합니다. AI와 로컬 서비스는 모델을 명시해야 합니다. 서비스 변경 시 모델을 자동 변경하지 않습니다.',
        scope: '일반 텍스트와 입력란 번역은 연결되었습니다. 독립 읽기/쓰기, 사전 조회와 두 동영상 런타임은 아직 완전히 보호되지 않습니다. 저장이 모든 기능 지원을 의미하지는 않습니다.',
        containment: '전용 경로를 설정하면 출처가 확인되지 않은 이미지, 영역, 단어 카드 번역과 이미지 능력 검사가 일반 페이지에서도 일시 중단됩니다. 두 항목을 지우면 기존 동작으로 돌아갑니다. 사전 조회는 이 제한으로 보호되지 않습니다.',
        source: '전용 경로가 설정된 경우 출처 불명 번역은 중단되지만 설정 저장은 가능합니다. 탭 없는 팝업 등은 지원되지 않을 수 있습니다. Firefox 140에는 documentId가 없으며 153 이상도 정확한 증거가 필요합니다. 비공개 다중 모델 비교는 미지원입니다.',
        spanning: 'spanning을 유지합니다. 비공개 창의 문서 페이지 접근은 브라우저가 결정하며 split 변경이나 데이터 이전은 없습니다.',
    },
    'fr-FR': {
        title: 'Routage de traduction privée', service: 'Service de traduction privée', model: 'Modèle de traduction privée',
        emptyService: 'Aucun service dédié', emptyModel: 'Aucun modèle dédié', unavailable: 'Indisponible',
        clear: 'Effacer le routage privé', connection: 'Configurer la connexion et les modèles du service',
        disabled: 'Routage dédié désactivé ; comportement existant conservé.', selected: 'Choisi', noModel: 'Ce service ne nécessite aucun modèle',
        invalid: 'Service ou modèle privé invalide. Vérifiez le choix, le corps avancé et le modèle du point de terminaison.',
        rules: 'Deux champs vides conservent le comportement existant. Les services sans modèle demandent uniquement le service. IA et local exigent un modèle explicite. Changer de service ne remplace pas le modèle.',
        scope: 'Le texte générique et la traduction de saisie sont connectés. Lecture/écriture indépendante, dictionnaire et les deux moteurs vidéo restent hors protection complète. Enregistrer ne rend pas toutes les fonctions compatibles.',
        containment: 'Avec une route dédiée, les traductions d’images, de zones et de fiches de mots ainsi que les tests visuels sans origine vérifiée sont suspendus, même sur les pages ordinaires. Effacer les deux champs rétablit le comportement existant. Le dictionnaire reste hors de ce contrôle.',
        source: 'Une origine inconnue bloque la traduction avec routage dédié, mais les réglages restent enregistrables. Les popups sans onglet peuvent être incompatibles. Firefox 140 manque de documentId ; 153+ exige encore une preuve exacte. La comparaison privée de modèles est indisponible.',
        spanning: 'Le mode spanning est conservé. Le navigateur décide de l’accès privé aux documents ; aucun passage à split ni migration de données.',
    },
    'ru-RU': {
        title: 'Отдельный маршрут приватного перевода', service: 'Сервис приватного перевода', model: 'Модель приватного перевода',
        emptyService: 'Отдельный сервис не выбран', emptyModel: 'Отдельная модель не выбрана', unavailable: 'Недоступно',
        clear: 'Очистить приватный маршрут', connection: 'Настроить подключение и список моделей',
        disabled: 'Отдельный маршрут выключен; сохранено прежнее поведение.', selected: 'Выбрано', noModel: 'Этому сервису модель не нужна',
        invalid: 'Неверный приватный сервис или модель. Проверьте выбор, расширенное тело запроса и модель адреса сервиса.',
        rules: 'Пустые поля сохраняют прежнее поведение. Сервису без модели нужен только выбор сервиса. ИИ и локальный сервис требуют явной модели. Смена сервиса не заменяет модель автоматически.',
        scope: 'Подключены общий перевод текста и перевод ввода. Отдельные чтение/письмо, словарь и оба видеомеханизма пока не защищены полностью. Сохранение не включает все функции.',
        containment: 'При отдельном маршруте перевод изображений, областей и карточек слов, а также проверка зрения без подтверждённого источника временно блокируются и на обычных страницах. Очистка обоих полей возвращает прежнее поведение. Словарь вне этой проверки.',
        source: 'Неизвестный источник блокирует перевод с отдельным маршрутом, но настройки сохраняются. Всплывающие страницы без вкладки могут не поддерживаться. В Firefox 140 нет documentId; 153+ всё ещё требует точного контекста. Приватное сравнение моделей недоступно.',
        spanning: 'Режим spanning сохраняется. Браузер определяет доступ к документам в приватном окне; перехода на split и переноса данных нет.',
    },
    'es-ES': {
        title: 'Ruta de traducción privada', service: 'Servicio de traducción privada', model: 'Modelo de traducción privada',
        emptyService: 'Sin servicio dedicado', emptyModel: 'Sin modelo dedicado', unavailable: 'No disponible',
        clear: 'Borrar la ruta privada', connection: 'Configurar la conexión y los modelos del servicio',
        disabled: 'Ruta dedicada desactivada; se conserva el comportamiento existente.', selected: 'Elegido', noModel: 'Este servicio no necesita modelo',
        invalid: 'Servicio o modelo privado no válido. Revise la selección, el cuerpo avanzado y el modelo del endpoint.',
        rules: 'Dos campos vacíos conservan el comportamiento existente. Los servicios sin modelo solo necesitan un servicio. IA y local requieren un modelo explícito. Cambiar de servicio no sustituye el modelo.',
        scope: 'El texto genérico y la traducción de entrada están conectados. Lectura/escritura independiente, diccionario y ambos motores de vídeo siguen sin protección completa. Guardar no habilita todas las funciones.',
        containment: 'Con una ruta dedicada, las traducciones de imágenes, áreas y tarjetas de palabras y las pruebas visuales sin origen verificado se suspenden incluso en páginas normales. Borrar ambos campos restaura el comportamiento existente. El diccionario queda fuera de este control.',
        source: 'Un origen desconocido detiene la traducción con ruta dedicada; los ajustes aún se guardan. Los popups sin pestaña pueden no ser compatibles. Firefox 140 carece de documentId; 153+ aún necesita evidencia exacta. La comparación privada de modelos no está disponible.',
        spanning: 'Se mantiene spanning. El navegador decide el acceso privado a documentos; no se cambia a split ni se migran datos.',
    },
};

export function getIncognitoRouteCopy(language: UiLanguage): Readonly<Copy> {
    return copies[language];
}
