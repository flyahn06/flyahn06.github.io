var previousClicked
var langIcons = {}
var langIconsColors = {}
var langIconsContents = {}

function setConstants() {
    langIcons = {
        'Python': document.getElementById('python-logo'),
        'C++': document.getElementById('cpluscplus-logo'),
        'MySql': document.getElementById('mysql-logo'),
        'Go': document.getElementById('go-logo'),
        'HTML': document.getElementById('html-logo'),
        'CSS': document.getElementById('css-logo'),
        'Javascript': document.getElementById('js-logo')
    }

    langIconsColors = {
        'Python': 'invert(39%) sepia(56%) saturate(632%) hue-rotate(166deg) brightness(92%) contrast(81%)',
        'C++': 'invert(22%) sepia(89%) saturate(1578%) hue-rotate(185deg) brightness(96%) contrast(103%)',
        'MySql': 'invert(45%) sepia(8%) saturate(2969%) hue-rotate(163deg) brightness(93%) contrast(83%)',
        'Go': 'invert(48%) sepia(56%) saturate(3138%) hue-rotate(160deg) brightness(100%) contrast(101%)',
        'HTML': 'invert(27%) sepia(25%) saturate(6417%) hue-rotate(355deg) brightness(116%) contrast(78%)',
        'CSS': 'invert(32%) sepia(19%) saturate(6805%) hue-rotate(186deg) brightness(92%) contrast(84%)',
        'Javascript': 'invert(96%) sepia(87%) saturate(7498%) hue-rotate(339deg) brightness(101%) contrast(94%)'
    }

    langIconsContents = {
        'Python': "<span class='strong'>메인</span>: 가장 먼저 시작한 언어입니다. <br>프로그래밍의 재미를 처음으로 알려줬습니다. <br>6년차입니다.",
        'C++': "<span class='strong'>서브</span>: 두 번째로 시작한 언어입니다. <br>파이썬만큼 익숙지는 않지만 열심히 배우는 중입니다. <br>구렁이 프로젝트의 기본 언어입니다.",
        'MySql': "첫 번째 데이터베이스입니다.<br>비트코인 당락 예측기를 만들며 처음 접했습니다.",
        'Go': "고루틴은 참 좋죠.",
        'HTML': "이 웹사이트를 만드려고 시작했습니다. <br>사용한 기간이 가장 짧아요.",
        'CSS': "이 웹사이트를 만드려고 시작했습니다. <br>사용한 기간이 가장 짧아요.",
        'Javascript': "예전부터 관심있었지만 정식으로 공부해본 적은 없었습니다. <br>마찬가지로 이 웹사이트를 만드려고 시작했어요. <br>두 번째로 사용한 기간이 짧아요."
    }

    previousClicked = document.getElementById('python-logo')

    document.getElementById('lang-intro-name').textContent = 'Python'
    document.getElementById('lang-intro-document').innerHTML = langIconsContents['Python']
    document.getElementById('lang-intro-name').style.filter = langIconsColors['Python']
}


function documentChange(icon) {
    previousClicked.style.filter = ""

    let lang_name = document.getElementById('lang-intro-name')
    let lang_content = document.getElementById('lang-intro-document')

    langIcons[icon].style.filter = langIconsColors[icon]
    lang_name.textContent = icon
    lang_name.style.filter = langIconsColors[icon]

    lang_content.innerHTML = langIconsContents[icon]
    //lang_content.style.filter = langIconsColors[icon]

    previousClicked = langIcons[icon]
}